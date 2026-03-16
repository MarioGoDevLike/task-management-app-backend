const mongoose = require('mongoose');

// Available permissions in the system
const AVAILABLE_PERMISSIONS = [
  'tasks.create',
  'tasks.read',
  'tasks.update',
  'tasks.delete',
  'tasks.assign',
  'users.create',
  'users.read',
  'users.update',
  'users.delete',
  'users.manage_roles',
  'teams.create',
  'teams.read',
  'teams.update',
  'teams.delete',
  'settings.read',
  'settings.update',
  'admin.access',
];

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Team name is required'],
    trim: true,
    unique: true,
    maxlength: [50, 'Team name cannot exceed 50 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  color: {
    type: String,
    default: '#3b82f6',
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Color must be a valid hex color']
  },
  icon: {
    type: String,
    default: 'users'
  },
  permissions: {
    type: [{
      type: String,
      enum: AVAILABLE_PERMISSIONS,
    }],
    default: []
  },
  isSystem: {
    type: Boolean,
    default: false // System teams (admin, manager, member) cannot be deleted
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for faster lookups
teamSchema.index({ name: 1 });
teamSchema.index({ isActive: 1 });

// Virtual for member count (will be populated when needed)
teamSchema.virtual('memberCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'teams',
  count: true
});

teamSchema.statics.AVAILABLE_PERMISSIONS = AVAILABLE_PERMISSIONS;

// Method to check if team has a specific permission
teamSchema.methods.hasPermission = function(permission) {
  return this.permissions.includes(permission) || this.permissions.includes('admin.access');
};

module.exports = mongoose.model('Team', teamSchema);

