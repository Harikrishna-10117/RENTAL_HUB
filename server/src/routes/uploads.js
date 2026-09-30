const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/auth');
const { AppError, asyncHandler, sendSuccess } = require('../utils/api');
const storage = require('../services/storage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new AppError('Upload a JPEG, PNG, or WebP image', 400, 'INVALID_IMAGE'));
    }
    return callback(null, true);
  }
});

router.get('/:filename', asyncHandler(async (req, res) => {
  const image = await storage.readLocalImage(req.params.filename);
  if (!image) throw new AppError('Image not found', 404, 'NOT_FOUND');
  res.set('Cache-Control', 'public, max-age=3600, immutable');
  res.type(image.mimeType).send(image.buffer);
}));

router.post('/', protect, (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return next(new AppError(
        tooLarge ? 'Image must be 5 MB or smaller' : 'Upload one image at a time',
        tooLarge ? 413 : 400,
        tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_UPLOAD'
      ));
    }
    return next(error);
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Choose an image to upload', 400, 'IMAGE_REQUIRED');
  const result = await storage.uploadImage(req.file);
  return sendSuccess(res, 'Image uploaded', result, 201);
}));

module.exports = router;