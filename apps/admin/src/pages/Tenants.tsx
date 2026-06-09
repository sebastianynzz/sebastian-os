import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card, PlanBadge, StatusBadge } from "../components/ui";

interface TenantRow {
  id: string;
  name: string;
  city: string;
  status: string;
  plan: string;
  counts: { users: number; drivers: number; vehicles: number; orders: number; clients: number };
  ordersLast30d: number;
}

export default function Tenants() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);

  useEffect(() => {
    void api<TenantRow[]>("GET", "/tenants").then(setTenants);
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Tenants</h1>
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-cielo/60">
              <th className="py-2">Empresa</th>
              <th>Ciudad</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Usuarios</th>
              <th>Conductores</th>
              <th>Negocios</th>
              <th>Pedidos (30d)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-white/5">
                <td className="py-2 font-medium">{t.name}</td>
                <td className="text-cielo">{t.city}</td>
                <td><PlanBadge plan={t.plan} /></td>
                <td><StatusBadge status={t.status} /></td>
                <td>{t.counts.users}</td>
                <td>{t.counts.drivers}</td>
                <td>{t.counts.clients}</td>
                <td>{t.ordersLast30d}</td>
                <td className="text-right">
                  <Link to={`/tenants/${t.id}`} className="text-lima hover:underline">
                    Gestionar →
                  </Link>
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-white/30">
                  Sin tenants.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
