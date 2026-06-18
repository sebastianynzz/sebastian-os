-- Tier 2 §10: capa de permisos de la app del conductor — política singleton por
-- tenant (app de navegación preferida + qué puede hacer el conductor con las
-- rutas). Aditiva: tabla nueva; segura para `prisma migrate deploy`.

CREATE TABLE "DriverPermissionPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "navApp" TEXT NOT NULL DEFAULT 'INTERNAL_GMAPS',
    "allowEditDispatcherRoutes" BOOLEAN NOT NULL DEFAULT false,
    "allowCreateRoutes" BOOLEAN NOT NULL DEFAULT false,
    "allowEditStartedRoutes" BOOLEAN NOT NULL DEFAULT false,
    "granular" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverPermissionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverPermissionPolicy_tenantId_key" ON "DriverPermissionPolicy"("tenantId");

ALTER TABLE "DriverPermissionPolicy" ADD CONSTRAINT "DriverPermissionPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
