"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import { CREATION_ACTION_CONFIRMATIONS } from "@/lib/creations/domain";
import {
  archiveAdminCreation,
  createAdminCreation,
  createAdminCreationCollaborator,
  createAdminCreationCollaboratorLink,
  createAdminCreationExternalLink,
  CreationServiceError,
  deleteAdminCreationExternalLink,
  deleteAdminCreationCollaborator,
  deleteAdminCreationCollaboratorLink,
  getAdminCreationSlugById,
  publishAdminCreation,
  unpublishAdminCreation,
  updateAdminCreation,
  updateAdminCreationCollaborator,
  updateAdminCreationCollaboratorLink,
  updateAdminCreationExternalLink,
} from "@/lib/creations/service";
import {
  assertCreationConfirmation,
  CREATION_EDITOR_FORM_FIELDS,
  CREATION_COLLABORATOR_FORM_FIELDS,
  CREATION_COLLABORATOR_LINK_FORM_FIELDS,
  CREATION_EXTERNAL_LINK_FORM_FIELDS,
  CreationAdminFormError,
  CreationValidationError,
  parseCreationExternalLinkIdentity,
  parseCreationCollaboratorIdentity,
  parseCreationCollaboratorLinkIdentity,
  parseCreationIdentity,
  parseCreationLockVersion,
  strictCreationFormData,
} from "@/lib/creations/validation";

async function authorize() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) {
    throw new Error("Origine refusée.");
  }
  return requireAdmin();
}

function refreshCreation(slug: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/creations");
  revalidatePath(`/admin/creations/${slug}`);
  revalidatePath("/creations");
  revalidatePath(`/creations/${slug}`);
}

function stateForError(error: unknown) {
  if (error instanceof CreationAdminFormError && error.code === "CONFIRMATION_REQUIRED") return "confirmation-requise";
  if (error instanceof CreationServiceError && error.code === "CONFLICT") return "conflit";
  if (error instanceof CreationServiceError && error.code === "SLUG_TAKEN") return "slug-occupe";
  if (error instanceof CreationServiceError && error.code === "SLUG_IMMUTABLE") return "slug-immuable";
  if (error instanceof CreationServiceError && error.code === "ARCHIVED") return "creation-archivee";
  if (error instanceof CreationServiceError && error.code === "MUST_UNPUBLISH") return "depublication-requise";
  if (error instanceof CreationServiceError && error.code === "LINK_TAKEN") return "lien-existant";
  if (error instanceof CreationServiceError && error.code === "COLLABORATOR_LINK_TAKEN") return "lien-collaborateur-existant";
  if (error instanceof CreationValidationError && (error.code === "INVALID_PLATFORM" || error.code === "INVALID_PLATFORM_HOST" || error.code === "INVALID_URL")) return "lien-collaborateur-invalide";
  if (error instanceof CreationValidationError && error.code.startsWith("PUBLICATION_BLOCKED")) return "publication-incomplete";
  return "operation-refusee";
}

function isRedirectError(error: unknown) {
  return Boolean(error && typeof error === "object" && "digest" in error);
}

async function redirectToCreation(creationId: string, state: string) {
  const creation = await getAdminCreationSlugById(creationId);
  if (!creation) redirect(`/admin/creations?etat=${encodeURIComponent(state)}`);
  redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=${encodeURIComponent(state)}`);
}

export async function createCreationAction(formData: FormData) {
  await authorize();
  try {
    const input = strictCreationFormData(formData, CREATION_EDITOR_FORM_FIELDS);
    const creation = await createAdminCreation(input);
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=creation-creee`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirect(`/admin/creations/nouveau?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function updateCreationAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, [...CREATION_EDITOR_FORM_FIELDS, "creationId", "lockVersion"]);
    creationId = parseCreationIdentity(input.creationId);
    const creation = await updateAdminCreation(
      creationId,
      parseCreationLockVersion(input.lockVersion),
      Object.fromEntries(CREATION_EDITOR_FORM_FIELDS.map((field) => [field, input[field]])),
    );
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=creation-enregistree`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

async function lifecycleAction(
  formData: FormData,
  operation: (creationId: string, lockVersion: number) => Promise<{ slug: string }>,
  expectedConfirmation: string,
  successState: string,
) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, ["creationId", "lockVersion", "confirmation"]);
    creationId = parseCreationIdentity(input.creationId);
    const lockVersion = parseCreationLockVersion(input.lockVersion);
    assertCreationConfirmation(input.confirmation, expectedConfirmation);
    const creation = await operation(creationId, lockVersion);
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=${encodeURIComponent(successState)}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function publishCreationAction(formData: FormData) {
  return lifecycleAction(formData, publishAdminCreation, CREATION_ACTION_CONFIRMATIONS.publish, "creation-publiee");
}

export async function unpublishCreationAction(formData: FormData) {
  return lifecycleAction(formData, unpublishAdminCreation, CREATION_ACTION_CONFIRMATIONS.unpublish, "creation-depubliee");
}

export async function archiveCreationAction(formData: FormData) {
  return lifecycleAction(formData, archiveAdminCreation, CREATION_ACTION_CONFIRMATIONS.archive, "creation-archivee");
}

export async function createCreationExternalLinkAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, [...CREATION_EXTERNAL_LINK_FORM_FIELDS, "creationId", "lockVersion"]);
    creationId = parseCreationIdentity(input.creationId);
    await createAdminCreationExternalLink(
      creationId,
      parseCreationLockVersion(input.lockVersion),
      Object.fromEntries(CREATION_EXTERNAL_LINK_FORM_FIELDS.map((field) => [field, input[field]])),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=lien-ajoute`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function updateCreationExternalLinkAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, [
      ...CREATION_EXTERNAL_LINK_FORM_FIELDS,
      "creationId",
      "externalLinkId",
      "lockVersion",
    ]);
    creationId = parseCreationIdentity(input.creationId);
    await updateAdminCreationExternalLink(
      creationId,
      parseCreationExternalLinkIdentity(input.externalLinkId),
      parseCreationLockVersion(input.lockVersion),
      Object.fromEntries(CREATION_EXTERNAL_LINK_FORM_FIELDS.map((field) => [field, input[field]])),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=lien-enregistre`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function deleteCreationExternalLinkAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, ["creationId", "externalLinkId", "lockVersion", "confirmation"]);
    creationId = parseCreationIdentity(input.creationId);
    assertCreationConfirmation(input.confirmation, CREATION_ACTION_CONFIRMATIONS.deleteExternalLink);
    await deleteAdminCreationExternalLink(
      creationId,
      parseCreationExternalLinkIdentity(input.externalLinkId),
      parseCreationLockVersion(input.lockVersion),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=lien-supprime`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function createCreationCollaboratorAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, [...CREATION_COLLABORATOR_FORM_FIELDS, "creationId", "lockVersion"]);
    creationId = parseCreationIdentity(input.creationId);
    await createAdminCreationCollaborator(
      creationId,
      parseCreationLockVersion(input.lockVersion),
      Object.fromEntries(CREATION_COLLABORATOR_FORM_FIELDS.map((field) => [field, input[field]])),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=collaborateur-ajoute`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function updateCreationCollaboratorAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, [...CREATION_COLLABORATOR_FORM_FIELDS, "creationId", "collaboratorId", "lockVersion"]);
    creationId = parseCreationIdentity(input.creationId);
    await updateAdminCreationCollaborator(
      creationId,
      parseCreationCollaboratorIdentity(input.collaboratorId),
      parseCreationLockVersion(input.lockVersion),
      Object.fromEntries(CREATION_COLLABORATOR_FORM_FIELDS.map((field) => [field, input[field]])),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=collaborateur-enregistre`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function deleteCreationCollaboratorAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, ["creationId", "collaboratorId", "lockVersion", "confirmation"]);
    creationId = parseCreationIdentity(input.creationId);
    assertCreationConfirmation(input.confirmation, CREATION_ACTION_CONFIRMATIONS.deleteCollaborator);
    await deleteAdminCreationCollaborator(
      creationId,
      parseCreationCollaboratorIdentity(input.collaboratorId),
      parseCreationLockVersion(input.lockVersion),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=collaborateur-supprime`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function createCreationCollaboratorLinkAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, [...CREATION_COLLABORATOR_LINK_FORM_FIELDS, "creationId", "collaboratorId", "lockVersion"]);
    creationId = parseCreationIdentity(input.creationId);
    await createAdminCreationCollaboratorLink(
      creationId,
      parseCreationCollaboratorIdentity(input.collaboratorId),
      parseCreationLockVersion(input.lockVersion),
      Object.fromEntries(CREATION_COLLABORATOR_LINK_FORM_FIELDS.map((field) => [field, input[field]])),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=lien-collaborateur-ajoute`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function updateCreationCollaboratorLinkAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, [...CREATION_COLLABORATOR_LINK_FORM_FIELDS, "creationId", "collaboratorId", "collaboratorLinkId", "lockVersion"]);
    creationId = parseCreationIdentity(input.creationId);
    await updateAdminCreationCollaboratorLink(
      creationId,
      parseCreationCollaboratorIdentity(input.collaboratorId),
      parseCreationCollaboratorLinkIdentity(input.collaboratorLinkId),
      parseCreationLockVersion(input.lockVersion),
      Object.fromEntries(CREATION_COLLABORATOR_LINK_FORM_FIELDS.map((field) => [field, input[field]])),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=lien-collaborateur-enregistre`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}

export async function deleteCreationCollaboratorLinkAction(formData: FormData) {
  await authorize();
  let creationId: string | null = null;
  try {
    const input = strictCreationFormData(formData, ["creationId", "collaboratorId", "collaboratorLinkId", "lockVersion", "confirmation"]);
    creationId = parseCreationIdentity(input.creationId);
    assertCreationConfirmation(input.confirmation, CREATION_ACTION_CONFIRMATIONS.deleteCollaboratorLink);
    await deleteAdminCreationCollaboratorLink(
      creationId,
      parseCreationCollaboratorIdentity(input.collaboratorId),
      parseCreationCollaboratorLinkIdentity(input.collaboratorLinkId),
      parseCreationLockVersion(input.lockVersion),
    );
    const creation = await getAdminCreationSlugById(creationId);
    if (!creation) redirect("/admin/creations?etat=operation-refusee");
    refreshCreation(creation.slug);
    redirect(`/admin/creations/${encodeURIComponent(creation.slug)}?etat=lien-collaborateur-supprime`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    if (creationId) return redirectToCreation(creationId, stateForError(error));
    redirect(`/admin/creations?etat=${encodeURIComponent(stateForError(error))}`);
  }
}
