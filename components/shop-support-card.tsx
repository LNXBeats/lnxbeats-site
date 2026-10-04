import Image from "next/image";
import Link from "next/link";

import { ButtonLink } from "@/components/button";

/** Editorial navigation only: deliberately independent of ShopProduct and checkout. */
export function ShopSupportCard() {
  return (
    <article className="shop-product-card shop-support-card" data-motion-tilt="shop-product">
      <Link className="shop-product-card__image" href="/soutenir" aria-label="Découvrir Soutenir LNX Beats">
        <span className="shop-product-media">
          <Image
            alt="Soutenir LNX Beats — visuel noir, blanc et or avec un cœur"
            src="/assets/support/shop-support-lnx-beats.png"
            width={1254}
            height={1254}
            sizes="(max-width: 429px) calc(100vw - 32px), (max-width: 900px) calc(50vw - 40px), (max-width: 1440px) calc(33vw - 48px), 340px"
          />
        </span>
      </Link>
      <div className="shop-product-card__body">
        <p className="shop-product-card__status">SOUTENIR LNX BEATS</p>
        <h3>Soutenir LNX Beats</h3>
        <div className="shop-support-card__copy">Soutien libre, sans contrepartie.</div>
        <div className="shop-product-card__footer">
          <div className="shop-product-card__actions">
            <ButtonLink href="/soutenir">SOUTENIR LNX BEATS</ButtonLink>
          </div>
        </div>
      </div>
    </article>
  );
}
