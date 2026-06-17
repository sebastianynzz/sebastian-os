import { describe, expect, it } from "vitest";
import { moduleDependencyHints, type ModuleKey } from "@moveos/shared";

/**
 * Pistas de dependencia para la UI de módulos: derivadas de la misma lógica
 * (`modulesToEnableWith` / `modulesBlockingDisable`) que aplica el backend en
 * la cascada de habilitación y el bloqueo 409, así el texto nunca diverge del
 * comportamiento real. Función pura — sin base de datos.
 */
describe("moduleDependencyHints", () => {
  it("requires = lo que se enciende en cascada (nombres en español)", () => {
    expect(moduleDependencyHints("SAFETY", []).requires).toEqual([
      "Telemática y GPS",
    ]);
    expect(moduleDependencyHints("COLD_CHAIN", []).requires).toEqual([
      "Telemática y GPS",
    ]);
    expect(moduleDependencyHints("AI_ADDONS", []).requires).toEqual([
      "Optimización de rutas",
    ]);
  });

  it("módulos sin dependencias no listan requisitos", () => {
    expect(moduleDependencyHints("ROUTE_OPTIMIZATION", []).requires).toEqual([]);
    expect(moduleDependencyHints("TELEMATICS", []).requires).toEqual([]);
  });

  it("el núcleo no aparece como requisito (EV_MANAGEMENT es núcleo, 1.3)", () => {
    // El núcleo siempre está activo: nunca se sugiere como dependencia a prender.
    expect(moduleDependencyHints("EV_MANAGEMENT", []).requires).toEqual([]);
  });

  it("requiredBy = módulos habilitados que impiden desactivarlo (el 409)", () => {
    const enabled: ModuleKey[] = ["SAFETY", "TELEMATICS", "EV_MANAGEMENT"];
    expect(moduleDependencyHints("TELEMATICS", enabled).requiredBy).toEqual([
      "Seguridad de carga",
    ]);
  });

  it("sin dependientes habilitados, requiredBy está vacío", () => {
    expect(moduleDependencyHints("TELEMATICS", ["TELEMATICS"]).requiredBy).toEqual(
      [],
    );
    // SAFETY habilitado pero nada depende de SAFETY → se puede desactivar.
    expect(
      moduleDependencyHints("SAFETY", ["SAFETY", "TELEMATICS"]).requiredBy,
    ).toEqual([]);
  });

  it("lista todos los dependientes habilitados (COLD_CHAIN y SAFETY → TELEMATICS)", () => {
    const enabled: ModuleKey[] = ["SAFETY", "COLD_CHAIN", "TELEMATICS"];
    const { requiredBy } = moduleDependencyHints("TELEMATICS", enabled);
    expect([...requiredBy].sort()).toEqual(
      ["Cadena de frío", "Seguridad de carga"].sort(),
    );
  });
});
