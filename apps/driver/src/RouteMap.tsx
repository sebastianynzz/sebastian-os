import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Mapa compacto de la ruta del día (D2): paradas numeradas en secuencia,
 * trazo del recorrido pendiente y posición del conductor. Los tiles OSM se
 * sirven cache-first desde el service worker y se pre-cachean al cargar la
 * ruta, así el mapa sobrevive zonas sin señal (donde Waze/Maps se quedan
 * en blanco). Sin imágenes de marcador: solo circleMarkers, cero assets.
 */

export interface MapStop {
  id: string;
  lat: number;
  lng: number;
  sequence: number;
  done: boolean;
  isPickup: boolean;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = "© OpenStreetMap";

export default function RouteMap({
  stops,
  geo,
  dark = false,
}: {
  stops: MapStop[];
  geo: React.MutableRefObject<{ lat: number; lng: number } | null>;
  /**
   * Tema oscuro (dark-first A3): con `.dark`, styles.css pinta las etiquetas
   * de secuencia en casi-blanco — los marcadores pasan a relleno navy para
   * que el número siga siendo legible (limón/cielo quedan como anillo).
   */
  dark?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driverMarkerRef = useRef<L.CircleMarker | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  // Crear el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    // crossOrigin: las peticiones de tiles salen en modo CORS — sin esto el
    // service worker recibe respuestas opacas (response.ok === false) y los
    // tiles navegados JAMÁS entrarían al caché offline (D2).
    L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);
    map.setView([4.654, -74.084], 12); // Bogotá por defecto hasta tener paradas
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Redibujar paradas/trazo SOLO cuando cambia la secuencia real (firma),
  // no por identidad del array: el fitBounds no debe robarle el encuadre al
  // conductor en cada refresco de 45 s.
  const drawnSignature = useRef<string | null>(null);
  const drawnStopsSignature = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const stopsSignature = stops
      .map((s) => `${s.id}:${s.sequence}:${s.done ? 1 : 0}`)
      .join("|");
    const signature = (dark ? "d|" : "l|") + stopsSignature;
    if (signature === drawnSignature.current) return;
    drawnSignature.current = signature;
    // Cambio de tema: repintar marcadores sin robarle el encuadre al conductor.
    const stopsChanged = stopsSignature !== drawnStopsSignature.current;
    drawnStopsSignature.current = stopsSignature;
    overlayRef.current?.remove();
    const overlay = L.layerGroup();
    overlayRef.current = overlay;

    const pending = stops.filter((s) => !s.done);
    if (pending.length > 1) {
      L.polyline(
        pending.map((s) => [s.lat, s.lng] as [number, number]),
        // Trazo de ruta: punteado 6 6 en Gris Señal (manual, sección Mapas).
        { color: "#8C949D", weight: 3, opacity: 0.7, dashArray: "6 6" },
      ).addTo(overlay);
    }
    for (const stop of stops) {
      // Paleta Circuito, sección Mapas del manual: la parada pendiente es
      // círculo Blanco Humo con borde Verde Eléctrico; la completada, Gris
      // Señal. La recogida se distingue por Verde Profundo (no por otro tono
      // de gris) para que siga siendo legible en ambos temas.
      const color = stop.done
        ? "#8C949D"
        : stop.isPickup
          ? "#0E4D2E"
          : "#00E571";
      const fillColor = dark
        ? stop.done
          ? "#1A2027"
          : stop.isPickup
            ? "#1A2027"
            : "#0C0F12"
        : stop.done
          ? "#E9EFEB"
          : "#F2F5F3";
      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius: 11,
        color,
        fillColor,
        fillOpacity: 0.95,
        weight: 2,
      }).addTo(overlay);
      marker.bindTooltip(String(stop.sequence), {
        permanent: true,
        direction: "center",
        className: "dalego-stop-label",
      });
    }
    overlay.addTo(map);

    const points = stops.map((s) => [s.lat, s.lng] as [number, number]);
    if (points.length > 0 && stopsChanged) {
      map.fitBounds(L.latLngBounds(points).pad(0.2));
    }
  }, [stops, dark]);

  // Posición del conductor: punto vivo refrescado cada 10 s desde el GPS.
  useEffect(() => {
    const interval = setInterval(() => {
      const map = mapRef.current;
      const pos = geo.current;
      if (!map || !pos) return;
      if (!driverMarkerRef.current) {
        // Manual, sección Mapas: el conductor es un punto Verde Eléctrico
        // con anillo.
        driverMarkerRef.current = L.circleMarker([pos.lat, pos.lng], {
          radius: 7,
          color: "#F2F5F3",
          fillColor: "#00E571",
          fillOpacity: 1,
          weight: 2,
        }).addTo(map);
      } else {
        driverMarkerRef.current.setLatLng([pos.lat, pos.lng]);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [geo]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Mapa de la ruta del día"
      className="h-52 w-full overflow-hidden rounded-xl border border-border shadow-soft dark:border-gris-senal/18"
    />
  );
}
