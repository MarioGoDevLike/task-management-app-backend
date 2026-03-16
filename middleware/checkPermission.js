const { hasPermission } = require('../utils/permissions');

/**
 * Middleware to check if user has a specific permission
 * @param {String} permission - Permission to check (e.g., 'tasks.create')
 * @returns {Function} Express middleware
 */
const checkPermission = (permission) => {
  return async (req, res, next) => {
    try {
      // Populate teams if not already populated
      if (req.user && req.user.teams) {
        // Check if teams are ObjectIds (not populated) or if they don't have permissions
        const needsPopulation = req.user.teams.length > 0 && (
          !req.user.teams[0].permissions || 
          typeof req.user.teams[0] === 'object' && req.user.teams[0]._id && !req.user.teams[0].permissions
        );
        
        if (needsPopulation) {
          await req.user.populate('teams');
        }
      }
      
      const hasAccess = await hasPermission(req.user, permission);
      
      if (!hasAccess) {
        return res.status(403).json({
          message: `Access denied. You need the '${permission}' permission to perform this action.`
        });
      }
      
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        message: 'Server error during permission check'
      });
    }
  };
};

module.exports = checkPermission;

