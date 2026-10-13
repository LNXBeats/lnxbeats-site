import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { DigitalCart } from "@/components/digital-cart";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import styles from "@/components/digital.module.css";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Panier numérique",robots:{index:false,follow:false}};
export default function Page(){try{requireDigitalEnvironment();}catch{notFound();}return <section className={styles.shell}><Container><p className="eyebrow">Discographie · musique numérique</p><h1>Mon panier musique.</h1><DigitalCart/></Container></section>;}
