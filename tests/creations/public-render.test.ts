import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("initial SSR renders every media combination without mounting or fetching a video", async () => {
  const script = String.raw`
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { CreationMediaStage } from "./components/creations/creation-media-stage.tsx";

    const asset = (kind) => ({
      id: kind,
      url: "/media/creations/" + kind,
      filename: kind + (kind === "audio" ? ".mp3" : ".mp4"),
      mimeType: kind === "audio" ? "audio/mpeg" : "video/mp4",
      sizeBytes: 42,
      width: kind === "audio" ? null : 1920,
      height: kind === "audio" ? null : 1080,
      durationMs: 60_000,
      alt: null,
    });
    const creation = (slug, primaryMedia, audio, video) => ({
      slug,
      title: "Création " + slug,
      summary: "Une création de test local.",
      description: null,
      collaborator: null,
      credits: null,
      category: "Collaboration",
      primaryMedia,
      position: 0,
      publishedAt: "2026-09-13T12:00:00.000Z",
      seo: { title: slug, description: slug },
      cover: null,
      poster: null,
      audio: audio ? asset("audio") : null,
      video: video ? asset("video") : null,
      links: [],
    });
    const render = (value) => renderToStaticMarkup(
      React.createElement(CreationMediaStage, { creations: [value], showRail: false, showGrid: false }),
    );
    const audioOnly = render(creation("audio", "audio", true, false));
    const videoOnly = render(creation("video", "video", false, true));
    const combined = render(creation("combined", "video", true, true));
    console.log(JSON.stringify({
      audioOnly: {
        audioControl: audioOnly.includes("creation-stage__audio-overlay"),
        videoLaunch: audioOnly.includes("Lire la vidéo"),
      },
      videoOnly: {
        videoMounted: videoOnly.includes("<video"),
        sourcePresent: videoOnly.includes("/media/creations/video"),
        videoLaunch: videoOnly.includes("Lire la vidéo"),
      },
      combined: {
        videoMounted: combined.includes("<video"),
        audioChoice: combined.includes("Écouter l’audio"),
        videoChoice: combined.includes("Voir la vidéo"),
      },
    }));
  `;
  const { stdout } = await execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_OPTIONS: "" },
  });

  assert.deepEqual(JSON.parse(stdout), {
    audioOnly: { audioControl: true, videoLaunch: false },
    videoOnly: { videoMounted: false, sourcePresent: false, videoLaunch: true },
    combined: { videoMounted: false, audioChoice: true, videoChoice: true },
  });
});
