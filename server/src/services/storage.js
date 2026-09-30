const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AppError } = require('../utils/api');

const imageTypes = {
  'image/jpeg': { extension: 'jpg', signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: 'png', signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/webp': { extension: 'webp', signature: (buffer) => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }
};

function provider() {
  return (process.env.UPLOAD_PROVIDER || 'local').toLowerCase();
}

function imageType(file) {
  const type = imageTypes[file.mimetype];
  if (!type || !type.signature(file.buffer)) {
    throw new AppError('Upload a valid JPEG, PNG, or WebP image', 400, 'INVALID_IMAGE');
  }
  return type;
}

function localDirectory() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
}

async function uploadImage(file) {
  const type = imageType(file);
  if (provider() === 'local') {
    const filename = `${crypto.randomUUID()}.${type.extension}`;
    await fs.mkdir(localDirectory(), { recursive: true });
    await fs.writeFile(path.join(localDirectory(), filename), file.buffer, { flag: 'wx' });
    return { url: `/api/uploads/${filename}`, mimeType: file.mimetype, size: file.size };
  }
  if (provider() !== 'cloudinary') {
    throw new AppError('Image storage provider is not supported', 503, 'UPLOAD_PROVIDER_UNAVAILABLE');
  }

  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError('Image storage provider is not configured', 503, 'UPLOAD_PROVIDER_NOT_CONFIGURED');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = process.env.CLOUDINARY_FOLDER || 'rentalhub';
  const signature = crypto.createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');
  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
      method: 'POST',
      body: form
    });
  } catch {
    throw new AppError('Image storage provider is unavailable', 502, 'UPLOAD_PROVIDER_UNAVAILABLE');
  }
  if (!response.ok) throw new AppError('Image storage provider rejected the upload', 502, 'UPLOAD_PROVIDER_ERROR');
  let result;
  try {
    result = await response.json();
  } catch {
    throw new AppError('Image storage provider returned an invalid response', 502, 'UPLOAD_PROVIDER_ERROR');
  }
  if (typeof result.secure_url !== 'string' || !result.secure_url.startsWith('https://')) {
    throw new AppError('Image storage provider returned an invalid image URL', 502, 'UPLOAD_PROVIDER_ERROR');
  }
  return { url: result.secure_url, mimeType: file.mimetype, size: file.size };
}

async function readLocalImage(filename) {
  const match = /^([a-f0-9-]{36})\.(jpg|png|webp)$/i.exec(filename);
  if (!match) return null;
  try {
    return {
      buffer: await fs.readFile(path.join(localDirectory(), filename)),
      mimeType: match[2].toLowerCase() === 'jpg' ? 'image/jpeg' : `image/${match[2].toLowerCase()}`
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

module.exports = { uploadImage, readLocalImage };