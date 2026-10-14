import { useNavigate } from "react-router-dom";

import { AlertsScreen } from "@/features/alerts/index.js";
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
