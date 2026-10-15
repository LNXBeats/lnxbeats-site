import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateDigitalContractPdf } from "@/lib/digital/documents";
import { digitalContractSnapshot } from "@/lib/digital/fulfillment-policy";
import { DIGITAL_FRANCE_TERMS_VERSION, DIGITAL_FRANCE_TERMS_TEXT, DIGITAL_FRANCE_TERMS_TEXT_HASH, digitalFranceTermsDraft,
  DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT, DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT } from "@/lib/digital/france-legal";

// Pure synthetic document fixture. No database, account, transport, gateway or media call.
const contract = digitalContractSnapshot({ name: "Acheteur synthétique QA", email: "contract-france@example.invalid" }, new Date("2026-10-15T12:00:00.000Z"), DIGITAL_FRANCE_TERMS_VERSION);
const masterId = "00000000-0000-4000-8000-000000000002";
const snapshot = { orderNumberSnapshot: "00000000-0000-4000-8000-000000000001", invoice: "DCN-QA-FACTURE-SYNTHETIQUE", contract, termsText: contract.terms.text,
  lineItemsSnapshot: [{ description: "Album synthétique de contrôle contractuel", lineTotalCents: 990 }],
  acquired: [{ content: [{ title: "Titre synthétique QA", masterId, formats: ["WAV", "MP3"] }] }],
  versions: [{ masterId, version: 1, format: "wav" }] };
const directory = resolve("output/dcn-france-commercial/contract-pdf");
await mkdir(directory, { recursive: true });
const bytes = await generateDigitalContractPdf(snapshot, "DCN-QA-CONTRAT-SYNTHETIQUE");
await writeFile(resolve(directory, "france-contract-qa.pdf"), bytes);
const text = ["LNX Beats - Conditions France DRAFT pour revue uniquement", "NON APPROUVE POUR LIVE. Aucun contrat réel ni avis juridique n’est attesté par cet export.",
  `Version : ${DIGITAL_FRANCE_TERMS_VERSION}`, `Empreinte SHA-256 du texte exact : ${DIGITAL_FRANCE_TERMS_TEXT_HASH}`,
  `Empreinte SHA-256 du document DRAFT avec métadonnées : ${digitalFranceTermsDraft.hashSha256}`,
  "Choix séparés proposés, non précochés : acceptation des conditions QA dans cette version ; demande expresse de fourniture immédiate ; reconnaissance relative à la rétractation.",
  DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT, DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT,
  "--- Texte exact des conditions proposé et hashé ---", DIGITAL_FRANCE_TERMS_TEXT];
await writeFile(resolve(directory, "../QA-France-terms-DRAFT.txt"), `${text.join("\n\n")}\n`, "utf8");
console.log(JSON.stringify({ path: resolve(directory, "france-contract-qa.pdf"), bytes: bytes.length, version: contract.terms.version, termsHash: contract.terms.hashSha256 }));
