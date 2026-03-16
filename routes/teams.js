const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const Team = require('../models/Team');
const User = require('../models/User');

const router = express.Router();

// All routes require authentication and admin role
router.use(auth, authorize('admin'));

// @route   GET /api/teams
// @desc    Get all teams
// @access  Private (admin)
router.get('/', async (req, res) => {
  try {
    const teams = await Team.find({ isActive: true })
      .sort({ isSystem: -1, name: 1 })
      .populate('createdBy', 'firstName lastName email');

    res.json({
      teams
    });
  } catch (error) {
    console.error('Teams fetch error:', error);
    res.status(500).json({
      message: 'Failed to fetch teams.'
    });
  }
});

// @route   GET /api/teams/:id
// @desc    Get a single team
// @access  Private (admin)
router.get('/:id', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email');

    if (!team) {
      return res.status(404).json({
        message: 'Team not found.'
      });
    }

    // Get member count
    const memberCount = await User.countDocuments({ teams: team._id });

    res.json({
      team: {
        ...team.toJSON(),
        memberCount
      }
    });
  } catch (error) {
    console.error('Team fetch error:', error);
    res.status(500).json({
      message: 'Failed to fetch team.'
    });
  }
});

// @route   POST /api/teams
// @desc    Create a new team
// @access  Private (admin)
router.post('/', [
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Team name is required and must be less than 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Description cannot exceed 200 characters'),
  body('color')
    .optional()
    .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .withMessage('Color must be a valid hex color'),
  body('permissions')
    .optional()
    .isArray()
    .withMessage('Permissions must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const { name, description, color, icon, permissions } = req.body;

    // Check if team name already exists
    const existingTeam = await Team.findOne({ name: name.trim() });
    if (existingTeam) {
      return res.status(400).json({
        message: 'Team with this name already exists.'
      });
    }

    // Validate permissions
    const validPermissions = Team.AVAILABLE_PERMISSIONS;
    const sanitizedPermissions = permissions
      ? [...new Set(permissions.filter(p => validPermissions.includes(p)))]
      : [];

    const team = new Team({
      name: name.trim(),
      description: description?.trim() || '',
      color: color || '#3b82f6',
      icon: icon || 'users',
      permissions: sanitizedPermissions,
      createdBy: req.user._id
    });

    await team.save();

    res.status(201).json({
      message: 'Team created successfully.',
      team
    });
  } catch (error) {
    console.error('Team creation error:', error);
    res.status(500).json({
      message: 'Failed to create team.'
    });
  }
});

// @route   PATCH /api/teams/:id
// @desc    Update a team
// @access  Private (admin)
router.patch('/:id', [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Team name must be less than 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Description cannot exceed 200 characters'),
  body('color')
    .optional()
    .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .withMessage('Color must be a valid hex color'),
  body('permissions')
    .optional()
    .isArray()
    .withMessage('Permissions must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({
        message: 'Team not found.'
      });
    }

    // System teams can only have permissions updated, not name
    if (team.isSystem && req.body.name && req.body.name !== team.name) {
      return res.status(400).json({
        message: 'System team names cannot be changed.'
      });
    }

    const { name, description, color, icon, permissions } = req.body;

    if (name && name.trim() !== team.name) {
      const existingTeam = await Team.findOne({ name: name.trim() });
      if (existingTeam) {
        return res.status(400).json({
          message: 'Team with this name already exists.'
        });
      }
      team.name = name.trim();
    }

    if (description !== undefined) team.description = description?.trim() || '';
    if (color) team.color = color;
    if (icon) team.icon = icon;

    if (permissions !== undefined) {
      const validPermissions = Team.AVAILABLE_PERMISSIONS;
      team.permissions = [...new Set(permissions.filter(p => validPermissions.includes(p)))];
    }

    await team.save();

    res.json({
      message: 'Team updated successfully.',
      team
    });
  } catch (error) {
    console.error('Team update error:', error);
    res.status(500).json({
      message: 'Failed to update team.'
    });
  }
});

// @route   DELETE /api/teams/:id
// @desc    Delete a team
// @access  Private (admin)
router.delete('/:id', async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({
        message: 'Team not found.'
      });
    }

    if (team.isSystem) {
      return res.status(400).json({
        message: 'System teams cannot be deleted.'
      });
    }

    // Check if team has members
    const memberCount = await User.countDocuments({ teams: team._id });
    if (memberCount > 0) {
      return res.status(400).json({
        message: `Cannot delete team with ${memberCount} member(s). Remove all members first.`
      });
    }

    // Soft delete
    team.isActive = false;
    await team.save();

    res.json({
      message: 'Team deleted successfully.'
    });
  } catch (error) {
    console.error('Team deletion error:', error);
    res.status(500).json({
      message: 'Failed to delete team.'
    });
  }
});

// @route   GET /api/teams/permissions/available
// @desc    Get all available permissions
// @access  Private (admin)
router.get('/permissions/available', (req, res) => {
  res.json({
    permissions: Team.AVAILABLE_PERMISSIONS
  });
});

module.exports = router;

