module.exports = (...requiredRoles) => {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];

    if (!userRoles.length) {
      return res.status(403).json({
        message: 'Access denied. User has no assigned roles.'
      });
    }

    const hasRole = requiredRoles.some(role => userRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({
        message: 'Access denied. Insufficient permissions.'
      });
    }

    next();
  };
};

