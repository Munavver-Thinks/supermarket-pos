import { useNavigate } from "react-router-dom";

import { DashboardScreen } from "@/main-menus/dashboard/index.js";
import { routePath } from "@/routes/routeConfig.js";

export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  return (
    <DashboardScreen
      onGoBilling={() => navigate(routePath("billing"))}
      onGoInventory={() => navigate(routePath("inventory"))}
    />
  );
}
