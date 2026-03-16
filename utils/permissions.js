const User = require('../models/User');
const Team = require('../models/Team');

/**
 * Get all effective permissions for a user
 * Combines permissions from teams and custom permissions
 * @param {Object} user - User document (should be populated with teams)
 * @returns {Array} Array of permission strings
 */
async function getUserPermissions(user) {
  const permissions = new Set();
  
  // Add custom permissions
  if (user.customPermissions && Array.isArray(user.customPermissions)) {
    user.customPermissions.forEach(perm => permissions.add(perm));
  }
  
  // Add permissions from teams
  if (user.teams && user.teams.length > 0) {
    // If teams are populated (objects), use them directly
    // Otherwise, fetch teams
    let teams;
    if (user.teams[0] && typeof user.teams[0] === 'object' && user.teams[0].permissions) {
      teams = user.teams;
    } else {
      teams = await Team.find({ _id: { $in: user.teams }, isActive: true });
    }
    
    teams.forEach(team => {
      if (team.permissions && Array.isArray(team.permissions)) {
        team.permissions.forEach(perm => permissions.add(perm));
      }
    });
  }
  
  // Admin role always has admin.access permission
  if (user.roles && user.roles.includes('admin')) {
    permissions.add('admin.access');
  }
  
  return Array.from(permissions);
}

/**
 * Check if user has a specific permission
 * @param {Object} user - User document
 * @param {String} permission - Permission to check (e.g., 'tasks.create')
 * @returns {Boolean}
 */
async function hasPermission(user, permission) {
  const permissions = await getUserPermissions(user);
  
  // admin.access grants all permissions
  if (permissions.includes('admin.access')) {
    return true;
  }
  
  return permissions.includes(permission);
}

/**
 * Check if user has any of the specified permissions
 * @param {Object} user - User document
 * @param {Array} permissionList - Array of permissions to check
 * @returns {Boolean}
 */
async function hasAnyPermission(user, permissionList) {
  const permissions = await getUserPermissions(user);
  
  // admin.access grants all permissions
  if (permissions.includes('admin.access')) {
    return true;
  }
  
  return permissionList.some(perm => permissions.includes(perm));
}

module.exports = {
  getUserPermissions,
  hasPermission,
  hasAnyPermission
};

