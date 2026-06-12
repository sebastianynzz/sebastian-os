/**
 * Deeplinks de navegación: integrar Waze/Google Maps, nunca construir
 * navegación propia. Único punto de verdad para el formato de los enlaces
 * (lo usan las tarjetas de parada y el directorio de carga).
 */
export function navLinks(lat: number, lng: number) {
  return {
    waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
    gmaps: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  };
}
