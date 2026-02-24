import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate caller
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerUserId = claimsData.claims.sub;

    // Parse body
    const { issue_id, user_ids } = await req.json();
    if (!issue_id || !Array.isArray(user_ids) || user_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "issue_id and user_ids[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service role client for reading auth.users emails
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch issue
    const { data: issue, error: issueErr } = await adminClient
      .from("bcf_issues")
      .select("*")
      .eq("id", issue_id)
      .single();

    if (issueErr || !issue) {
      return new Response(
        JSON.stringify({ error: "Issue not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch target user emails from auth.users
    const sentResults: { user_id: string; email: string; status: string }[] = [];
    const appUrl = req.headers.get("origin") || "https://gemini-spark-glow.lovable.app";

    for (const userId of user_ids) {
      try {
        // Get email from auth.users via admin API
        const { data: authUser, error: authErr } = await adminClient.auth.admin.getUserById(userId);
        if (authErr || !authUser?.user?.email) {
          sentResults.push({ user_id: userId, email: "", status: "no_email" });
          continue;
        }
        const email = authUser.user.email;

        // Upsert assignment with token
        const { data: assignment, error: assignErr } = await adminClient
          .from("bcf_issue_assignments")
          .upsert(
            {
              issue_id,
              assigned_to_user_id: userId,
              assigned_by_user_id: callerUserId,
              sent_at: new Date().toISOString(),
            },
            { onConflict: "issue_id,assigned_to_user_id", ignoreDuplicates: false }
          )
          .select("token")
          .single();

        if (assignErr) {
          // If upsert fails due to no unique constraint, do insert
          const { data: inserted, error: insErr } = await adminClient
            .from("bcf_issue_assignments")
            .insert({
              issue_id,
              assigned_to_user_id: userId,
              assigned_by_user_id: callerUserId,
              sent_at: new Date().toISOString(),
            })
            .select("token")
            .single();
          
          if (insErr) {
            sentResults.push({ user_id: userId, email, status: "db_error" });
            continue;
          }
          
          const token = inserted?.token;
          await sendEmail(resendApiKey, email, issue, `${appUrl}/issue/${token}`);
          sentResults.push({ user_id: userId, email, status: "sent" });
        } else {
          const token = assignment?.token;
          await sendEmail(resendApiKey, email, issue, `${appUrl}/issue/${token}`);
          sentResults.push({ user_id: userId, email, status: "sent" });
        }
      } catch (err) {
        console.error(`Failed to send to ${userId}:`, err);
        sentResults.push({ user_id: userId, email: "", status: "error" });
      }
    }

    const sentCount = sentResults.filter((r) => r.status === "sent").length;

    return new Response(
      JSON.stringify({ sent: sentCount, total: user_ids.length, results: sentResults }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-issue-email error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function sendEmail(
  apiKey: string,
  to: string,
  issue: any,
  deepLink: string
) {
  const priorityColors: Record<string, string> = {
    low: "#94a3b8",
    medium: "#f59e0b",
    high: "#f97316",
    critical: "#ef4444",
  };
  const priorityColor = priorityColors[issue.priority] || "#94a3b8";

  const issueTypeLabels: Record<string, string> = {
    fault: "Fault",
    improvement: "Improvement",
    question: "Question",
    observation: "Observation",
  };

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="margin-bottom: 4px;">${escapeHtml(issue.title)}</h2>
      <p style="color: #666; margin-top: 0;">
        <span style="display: inline-block; padding: 2px 8px; border-radius: 12px; background: ${priorityColor}; color: white; font-size: 12px; font-weight: 600;">
          ${issue.priority?.toUpperCase() || "MEDIUM"}
        </span>
        &nbsp;
        <span style="color: #888;">${issueTypeLabels[issue.issue_type] || issue.issue_type}</span>
        ${issue.building_name ? ` · ${escapeHtml(issue.building_name)}` : ""}
      </p>
      ${issue.screenshot_url ? `<img src="${issue.screenshot_url}" alt="Issue screenshot" style="max-width: 100%; border-radius: 8px; margin: 16px 0;" />` : ""}
      ${issue.description ? `<p style="color: #333;">${escapeHtml(issue.description)}</p>` : ""}
      <a href="${deepLink}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 16px;">
        View &amp; Resolve Issue
      </a>
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        This issue was assigned to you via Geminus. Click the button above to view details and respond.
      </p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Geminus <onboarding@resend.dev>",
      to: [to],
      subject: `Issue: ${issue.title}`,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error: ${res.status} ${errText}`);
  }
  await res.text(); // consume body
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
