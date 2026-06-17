-- Vistas guardadas del panel: filtros con nombre por usuario+tenant+página.
-- Aditiva (tabla nueva), segura para `migrate deploy`.
CREATE TABLE "SavedView" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "page"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "filters"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedView_tenantId_userId_page_name_key"
  ON "SavedView" ("tenantId", "userId", "page", "name");
CREATE INDEX "SavedView_tenantId_userId_page_idx"
  ON "SavedView" ("tenantId", "userId", "page");

ALTER TABLE "SavedView"
  ADD CONSTRAINT "SavedView_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedView"
  ADD CONSTRAINT "SavedView_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
