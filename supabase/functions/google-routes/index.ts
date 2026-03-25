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
    const apiKey = Deno.env.get('GOOGLE_ROUTES_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Google Routes API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { origin, destination, departureTime } = await req.json();

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return new Response(
        JSON.stringify({ error: 'Missing origin or destination coordinates (lat, lng)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = {
      origin: {
        location: {
          latLng: { latitude: origin.lat, longitude: origin.lng },
        },
      },
      destination: {
        location: {
          latLng: { latitude: destination.lat, longitude: destination.lng },
        },
      },
      travelMode: 'TRANSIT',
      computeAlternativeRoutes: false,
      transitPreferences: {
        routingPreference: 'FEWER_TRANSFERS',
      },
      ...(departureTime ? { departureTime } : {}),
    };

    const fieldMask = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.transitDetails,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters,routes.legs.steps.startLocation,routes.legs.steps.endLocation';

    const response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.routes || data.routes.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No transit route found', details: data.error?.message || 'Unknown' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const route = data.routes[0];

    // Decode Google encoded polyline to GeoJSON coordinates
    const geometry = decodePolyline(route.polyline?.encodedPolyline || '');

    // Extract transit steps
    const steps = (route.legs || []).flatMap((leg: any) =>
      (leg.steps || []).map((step: any) => {
        const base: any = {
          travelMode: step.travelMode,
          distance: step.distanceMeters,
          duration: step.staticDuration,
        };
        // Include start location for click-to-zoom on every step
        if (step.startLocation?.latLng) {
          base.maneuver = {
            location: [step.startLocation.latLng.longitude, step.startLocation.latLng.latitude],
          };
        }
        // Add a human-readable instruction for walking steps
        if (step.travelMode === 'WALK' && step.distanceMeters) {
          base.instruction = `Walk ${step.distanceMeters < 1000 ? Math.round(step.distanceMeters) + ' m' : (step.distanceMeters / 1000).toFixed(1) + ' km'}`;
        }
        if (step.transitDetails) {
          const td = step.transitDetails;
          base.transit = {
            lineName: td.transitLine?.nameShort || td.transitLine?.name || '',
            lineColor: td.transitLine?.color || null,
            vehicleType: td.transitLine?.vehicle?.type || '',
            departureStop: td.stopDetails?.departureStop?.name || '',
            arrivalStop: td.stopDetails?.arrivalStop?.name || '',
            departureTime: td.stopDetails?.departureTime || null,
            arrivalTime: td.stopDetails?.arrivalTime || null,
            numStops: td.stopCount || 0,
            departureLocation: step.startLocation?.latLng
              ? { lat: step.startLocation.latLng.latitude, lng: step.startLocation.latLng.longitude }
              : undefined,
          };
        }
        return base;
      })
    );

    // Parse duration string like "1234s" to number
    const durationSeconds = parseDuration(route.duration);

    return new Response(
      JSON.stringify({
        geometry,
        distance: route.distanceMeters || 0,
        duration: durationSeconds,
        steps,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Google Routes error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/** Decode Google encoded polyline to GeoJSON LineString */
function decodePolyline(encoded: string): GeoJSON.LineString {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return { type: 'LineString', coordinates };
}

/** Parse Google duration string "123s" → number of seconds */
function parseDuration(d: string | undefined): number {
  if (!d) return 0;
  const match = d.match(/^(\d+)s$/);
  return match ? parseInt(match[1], 10) : 0;
}
