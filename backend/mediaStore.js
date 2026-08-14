const cloudinary = require("cloudinary").v2;

const MAX_MEDIA_SIZE = {
  image: 8 * 1024 * 1024,
  video: 25 * 1024 * 1024,
  audio: 15 * 1024 * 1024
};

const ALLOWED_MIME = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/octet-stream"],
  video: ["video/mp4", "video/webm", "video/quicktime", "application/octet-stream"],
  audio: ["audio/mpeg", "audio/wav", "audio/webm", "audio/mp4", "audio/aac", "application/octet-stream"]
};

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  return cloudinary;
}

function validateMediaFile(fileBuffer, originalName, mimeType, mediaType) {
  if (!fileBuffer || fileBuffer.length === 0) {
    return { valid: false, error: "Empty file received." };
  }

  if (!MAX_MEDIA_SIZE[mediaType]) {
    return { valid: false, error: "Unsupported media type." };
  }

  const maxSize = MAX_MEDIA_SIZE[mediaType];
  if (fileBuffer.length > maxSize) {
    return { valid: false, error: `${mediaType} exceeds the ${Math.round(maxSize / (1024 * 1024))}MB limit.` };
  }

  const allowedMime = ALLOWED_MIME[mediaType] || [];
  const normalizedMime = mimeType || "application/octet-stream";

  if (!allowedMime.includes(normalizedMime) && normalizedMime !== "application/octet-stream") {
    return { valid: false, error: `Invalid ${mediaType} MIME type.` };
  }

  const extension = String(originalName || "").split(".").pop()?.toLowerCase();
  if (!extension && normalizedMime === "application/octet-stream") {
    return { valid: false, error: "Missing file extension." };
  }

  return { valid: true };
}

function buildCloudinaryResource(mediaType) {
  return {
    folder: "secure-media",
    resource_type: "raw",
    public_id: `${mediaType}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    overwrite: false
  };
}

function inferMediaTypeFromPublicId(publicId = "") {
  const compact = String(publicId).split("/").pop() || "";
  if (compact.startsWith("image-")) return "image";
  if (compact.startsWith("video-")) return "video";
  if (compact.startsWith("audio-")) return "audio";
  return "image";
}

function inferMimeType(mediaType, format) {
  const ext = String(format || "").toLowerCase();
  if (mediaType === "image") {
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    return "image/jpeg";
  }

  if (mediaType === "video") {
    if (ext === "webm") return "video/webm";
    if (ext === "mov") return "video/quicktime";
    return "video/mp4";
  }

  if (mediaType === "audio") {
    if (ext === "wav") return "audio/wav";
    if (ext === "webm") return "audio/webm";
    if (ext === "aac") return "audio/aac";
    if (ext === "m4a" || ext === "mp4") return "audio/mp4";
    return "audio/mpeg";
  }

  return "application/octet-stream";
}

async function uploadEncryptedMediaToCloudinary(fileBuffer, { mediaType, originalName, sessionId, sender, mimeType }) {
  const cloudinaryClient = getCloudinaryConfig();

  if (!cloudinaryClient) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }

  const extension = String(originalName || "").split(".").pop()?.toLowerCase() || "enc";
  const uploadOptions = buildCloudinaryResource(mediaType);
  uploadOptions.public_id = `${mediaType}-${sessionId || "session"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinaryClient.uploader.upload_stream(
      {
        ...uploadOptions,
        format: extension,
        type: "private",
        resource_type: "raw",
        context: {
          originalName: String(originalName || ""),
          sender: String(sender || ""),
          mimeType: String(mimeType || "")
        }
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result || !result.secure_url) {
          reject(new Error("Cloudinary upload did not return a valid URL."));
          return;
        }

        resolve({
          secure_url: result.secure_url,
          public_id: result.public_id,
          asset_id: result.asset_id,
          bytes: result.bytes,
          resource_type: result.resource_type || "raw"
        });
      }
    );

    stream.end(fileBuffer);
  });
}

async function listEncryptedMediaFromCloudinary() {
  const cloudinaryClient = getCloudinaryConfig();

  if (!cloudinaryClient) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }

  const collected = [];
  let nextCursor;

  do {
    const response = await cloudinaryClient.api.resources({
      type: "private",
      resource_type: "raw",
      prefix: "secure-media/",
      max_results: 500,
      next_cursor: nextCursor,
      context: true
    });

    const resources = Array.isArray(response.resources) ? response.resources : [];
    for (const resource of resources) {
      const mediaType = inferMediaTypeFromPublicId(resource.public_id || "");
      const context = resource.context && resource.context.custom ? resource.context.custom : {};

      collected.push({
        id: resource.public_id,
        mediaType,
        sender: context.sender || "unknown",
        secureUrl: resource.secure_url,
        publicId: resource.public_id,
        assetId: resource.asset_id,
        originalName: context.originalName || `${mediaType}.${resource.format || "bin"}`,
        mimeType: context.mimeType || inferMimeType(mediaType, resource.format),
        uploadedAt: resource.created_at || new Date().toISOString(),
        size: resource.bytes || 0,
        encrypted: true
      });
    }

    nextCursor = response.next_cursor;
  } while (nextCursor);

  return collected;
}

async function deleteEncryptedMediaFromCloudinary(publicId) {
  const cloudinaryClient = getCloudinaryConfig();

  if (!cloudinaryClient) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }

  if (!publicId) {
    return { result: "not found" };
  }

  return new Promise((resolve, reject) => {
    cloudinaryClient.uploader.destroy(
      publicId,
      {
        resource_type: "raw",
        type: "private",
        invalidate: true
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result || { result: "unknown" });
      }
    );
  });
}

async function fetchEncryptedBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch encrypted media: ${response.status}`);
  }
  return response.arrayBuffer();
}

module.exports = {
  MAX_MEDIA_SIZE,
  ALLOWED_MIME,
  validateMediaFile,
  uploadEncryptedMediaToCloudinary,
  listEncryptedMediaFromCloudinary,
  deleteEncryptedMediaFromCloudinary,
  fetchEncryptedBinary
};
