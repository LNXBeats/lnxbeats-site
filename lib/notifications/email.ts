import "server-only";

import { parseNotificationConfiguration } from "@/lib/notifications/config";
import { orderNotificationTemplate } from "@/lib/notifications/templates";
import { createNotificationTransport } from "@/lib/notifications/transport";
import type { OrderNotificationMessage } from "@/lib/notifications/types";

export async function sendOrderNotificationEmail(message: OrderNotificationMessage) {
  const configuration = parseNotificationConfiguration();
  const template = orderNotificationTemplate(message, configuration);
  return createNotificationTransport(configuration).send(message, template);
}
