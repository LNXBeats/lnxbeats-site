import { orderOffer } from "./order-offer";

// One photo per request. The fixed allowance covers the bounded multipart
// boundary, filename, content headers and rights-confirmation field.
export const ORDER_PHOTO_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const ORDER_PHOTO_MULTIPART_MAX_BYTES = orderOffer.maxPhotoBytes
  + ORDER_PHOTO_MULTIPART_OVERHEAD_BYTES;
