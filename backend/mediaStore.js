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

function inferMimeTypeFromFilename(filename, mediaType) {
  const ext = String(filename || "").split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "mp4") return mediaType === "audio" ? "audio/mp4" : "video/mp4";
  if (ext === "webm") return mediaType === "audio" ? "audio/webm" : "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "aac") return "audio/aac";
  
  if (mediaType === "image") return "image/jpeg";
  if (mediaType === "video") return "video/mp4";
  if (mediaType === "audio") return "audio/mpeg";
  return "application/octet-stream";
}

function parseCloudinaryResource(resource) {
  const custom = (resource.context && resource.context.custom) 
    ? resource.context.custom 
    : (resource.context || {});

  const publicId = resource.public_id || "";
  let mediaType = custom.mediaType;
  if (!mediaType) {
    if (publicId.includes("/video-") || publicId.startsWith("video-")) {
      mediaType = "video";
    } else if (publicId.includes("/audio-") || publicId.startsWith("audio-")) {
      mediaType = "audio";
    } else {
      mediaType = "image";
    }
  }

  // Extract ID
  const id = custom.mediaId || resource.asset_id || publicId.replace(/^secure-media\//, "");
  const originalName = custom.originalName || resource.display_name || resource.filename || `${mediaType}-file`;
  const mimeType = custom.mimeType || inferMimeTypeFromFilename(originalName, mediaType);
  const sender = custom.sender || "unknown";
  const uploadedAt = custom.uploadedAt || resource.uploaded_at || resource.created_at || new Date().toISOString();

  return {
    id,
    mediaType,
    sender,
    secureUrl: resource.secure_url || resource.url,
    publicId: resource.public_id,
    assetId: resource.asset_id,
    originalName,
    mimeType,
    uploadedAt,
    size: resource.bytes || 0,
    encrypted: true
  };
}

async function fetchCloudinaryMediaList() {
  const cloudinaryClient = getCloudinaryConfig();
  if (!cloudinaryClient) {
    return [];
  }

  try {
    const items = [];
    let nextCursor = null;

    do {
      const options = {
        resource_type: "raw",
        type: "private",
        prefix: "secure-media",
        max_results: 500,
        context: true,
        tags: true
      };
      if (nextCursor) {
        options.next_cursor = nextCursor;
      }

      const res = await cloudinaryClient.api.resources(options);
      if (res && Array.isArray(res.resources)) {
        res.resources.forEach(r => items.push(parseCloudinaryResource(r)));
      }
      nextCursor = res ? res.next_cursor : null;
    } while (nextCursor);

    // Sort by uploadedAt ascending (chronological order)
    items.sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
    return items;
  } catch (error) {
    console.error("Failed to list media from Cloudinary:", error);
    return [];
  }
}

async function findCloudinaryMediaById(mediaId) {
  if (!mediaId) return null;
  const list = await fetchCloudinaryMediaList();
  return list.find(item => 
    item.id === mediaId || 
    item.assetId === mediaId || 
    item.publicId === mediaId ||
    item.publicId === `secure-media/${mediaId}` ||
    item.publicId.includes(mediaId)
  ) || null;
}

async function uploadEncryptedMediaToCloudinary(fileBuffer, { mediaType, originalName, sessionId, sender, mimeType, mediaId }) {
  const cloudinaryClient = getCloudinaryConfig();

  if (!cloudinaryClient) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }

  const generatedId = mediaId || `media_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const cleanOriginalName = originalName || `${mediaType}.bin`;
  const cleanMimeType = mimeType || inferMimeTypeFromFilename(cleanOriginalName, mediaType);
  const extension = String(cleanOriginalName).split(".").pop()?.toLowerCase() || "enc";

  const uploadOptions = buildCloudinaryResource(mediaType);
  uploadOptions.public_id = `${mediaType}-${sessionId || "session"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const contextData = {
    mediaId: generatedId,
    mediaType,
    sender: sender || "unknown",
    originalName: cleanOriginalName,
    mimeType: cleanMimeType,
    uploadedAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const stream = cloudinaryClient.uploader.upload_stream(
      {
        ...uploadOptions,
        format: extension,
        type: "private",
        resource_type: "raw",
        context: contextData,
        tags: ["secure-vault", mediaType]
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
          id: generatedId,
          mediaType,
          sender: sender || "unknown",
          secure_url: result.secure_url,
          public_id: result.public_id,
          asset_id: result.asset_id,
          bytes: result.bytes,
          resource_type: result.resource_type || "raw",
          originalName: cleanOriginalName,
          mimeType: cleanMimeType,
          uploadedAt: contextData.uploadedAt
        });
      }
    );

    stream.end(fileBuffer);
  });
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
  deleteEncryptedMediaFromCloudinary,
  fetchCloudinaryMediaList,
  findCloudinaryMediaById,
  fetchEncryptedBinary
};

