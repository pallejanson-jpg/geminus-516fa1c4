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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate caller
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerEmail = userData.user.email || "okänd";
    const callerName = userData.user.user_metadata?.full_name || userData.user.user_metadata?.name || callerEmail;

    const { title, description, category } = await req.json();
    if (!title) {
      return new Response(
        JSON.stringify({ error: "title required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Find admin user IDs
    const { data: adminRoles } = await adminClient
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!adminRoles || adminRoles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No admins to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const appUrl = "https://gemini-spark-glow.lovable.app";
    const categoryLabels: Record<string, string> = {
      suggestion: "Förslag",
      ux_issue: "UX-problem",
      bug: "Bugg",
      question: "Fråga",
    };

    const sent: string[] = [];

    for (const { user_id } of adminRoles) {
      try {
        const { data: authUser } = await adminClient.auth.admin.getUserById(user_id);
        const email = authUser?.user?.email;
        if (!email) continue;

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Geminus <noreply@swgcloud.se>",
            to: [email],
            subject: `[Feedback] ${title}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px;">
                <h2 style="color: #333;">Ny feedback från ${callerName}</h2>
                <p><strong>Kategori:</strong> ${categoryLabels[category] || category}</p>
                <p><strong>Titel:</strong> ${title}</p>
                ${description ? `<p><strong>Beskrivning:</strong><br/>${description.replace(/\n/g, "<br/>")}</p>` : ""}
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="color: #666; font-size: 13px;">
                  Användarens e-post: ${callerEmail}<br/>
                  <a href="${appUrl}" style="color: #2563eb;">Öppna Geminus</a>
                </p>
              </div>
            `,
          }),
        });

        if (res.ok) sent.push(email);
      } catch (err) {
        console.error(`Failed to notify ${user_id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, notified: sent.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("feedback-notify error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
