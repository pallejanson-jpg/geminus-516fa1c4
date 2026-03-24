import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const mapboxToken = Deno.env.get('MAPBOX_ACCESS_TOKEN');
    if (!mapboxToken) {
      return new Response(
        JSON.stringify({ error: 'Mapbox token not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { origin, destination, profile = 'walking' } = await req.json();

    if (!origin || !destination || !origin.lng || !origin.lat || !destination.lng || !destination.lat) {
      return new Response(
        JSON.stringify({ error: 'Missing origin or destination coordinates (lng, lat)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validProfiles = ['walking', 'driving', 'cycling'];
    const safeProfile = validProfiles.includes(profile) ? profile : 'walking';

    const url = `https://api.mapbox.com/directions/v5/mapbox/${safeProfile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?geometries=geojson&overview=full&steps=true&access_token=${mapboxToken}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || !data.routes || data.routes.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No route found', details: data.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const route = data.routes[0];

    return new Response(
      JSON.stringify({
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration,
        steps: route.legs?.[0]?.steps?.map((s: any) => ({
          instruction: s.maneuver?.instruction,
          distance: s.distance,
          duration: s.duration,
          maneuver: s.maneuver?.location ? { location: s.maneuver.location } : undefined,
        })),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Mapbox directions error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
