import { useNavigate } from "react-router-dom";

import { AlertsScreen } from "@/main-modules/alerts/index.js";
import { routePath } from "@/routes/routeConfig.js";

export function NotificationsPage(): JSX.Element {
  const navigate = useNavigate();
  return (
    <AlertsScreen
      onGoInventory={() => navigate(routePath("inventory"))}
      onGoPurchases={() => navigate(routePath("purchases"))}
    />
  );
}
