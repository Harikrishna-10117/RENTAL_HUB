const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema({
  line1: { type: String, trim: true, maxlength: 160, default: '' },
  line2: { type: String, trim: true, maxlength: 160, default: '' },
  city: { type: String, trim: true, maxlength: 100, default: '' },
  region: { type: String, trim: true, maxlength: 100, default: '' },
  postalCode: { type: String, trim: true, maxlength: 20, default: '' },
  country: { type: String, trim: true, maxlength: 80, default: 'India' }
}, { _id: false });

const vehicleInfoSchema = new mongoose.Schema({
  vehicleType: { type: String, trim: true, maxlength: 80, default: '' },
  makeModel: { type: String, trim: true, maxlength: 120, default: '' },
  registrationNumber: { type: String, trim: true, maxlength: 30, default: '' }
}, { _id: false });

const serviceAreaSchema = new mongoose.Schema({
  cities: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  states: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  pincodes: { type: [{ type: String, trim: true, maxlength: 10 }], default: [] }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  role: { type: String, enum: ['customer', 'owner', 'transporter', 'admin'], default: 'customer' },
  phone: { type: String, trim: true, default: '' },
  profileImageUrl: { type: String, trim: true, maxlength: 2048, default: '' },
  address: { type: addressSchema, default: () => ({}) },
  vehicleInfo: { type: vehicleInfoSchema, default: () => ({}) },
  serviceArea: { type: serviceAreaSchema, default: () => ({}) },
  preferredLanguage: { type: String, enum: ['en', 'hi', 'ta'], default: 'en' },
  businessName: { type: String, trim: true, maxlength: 120, default: '' },
  businessType: { type: String, trim: true, maxlength: 80, default: '' },
  businessDescription: { type: String, trim: true, maxlength: 1000, default: '' },
  tokenVersion: { type: Number, default: 0, min: 0 },
  ownerVerified: { type: Boolean, default: false },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $gt: '' } } });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
