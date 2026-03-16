const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const User = require('../models/User');
const Team = require('../models/Team');
const Task = require('../models/Task');

const router = express.Router();
const ROLE_VALUES = User.ROLE_VALUES || ['admin', 'manager', 'member'];

// All routes below require authentication and admin role
router.use(auth, authorize('admin'));

// @route   GET /api/admin/users
// @desc    Get list of all users
// @access  Private (admin)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password -loginAttempts -lockUntil')
      .populate('teams', 'name color icon permissions')
      .sort({ createdAt: 1 });

    res.json({
      users
    });
  } catch (error) {
    console.error('Admin users fetch error:', error);
    res.status(500).json({
      message: 'Failed to fetch users.'
    });
  }
});

// @route   POST /api/admin/users
// @desc    Create a new user (admin only)
// @access  Private (admin)
router.post('/users', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name is required and must be less than 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name is required and must be less than 50 characters'),
  body('roles')
    .optional()
    .isArray()
    .withMessage('Roles must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const { email, password, firstName, lastName, roles } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        message: 'User with this email already exists.'
      });
    }

    // Validate roles if provided
    let sanitizedRoles = roles || ['member'];
    if (Array.isArray(roles) && roles.length > 0) {
      sanitizedRoles = [...new Set(
        roles
          .filter(role => typeof role === 'string')
          .map(role => role.toLowerCase().trim())
          .filter(role => ROLE_VALUES.includes(role))
      )];
      if (!sanitizedRoles.length) {
        sanitizedRoles = ['member'];
      }
    }

    const { teams } = req.body;

    // Validate teams if provided
    let teamIds = [];
    if (Array.isArray(teams) && teams.length > 0) {
      const validTeams = await Team.find({ _id: { $in: teams }, isActive: true });
      teamIds = validTeams.map(t => t._id);
    }

    // Create new user
    const user = new User({
      email,
      password,
      firstName,
      lastName,
      roles: sanitizedRoles,
      teams: teamIds
    });

    await user.save();
    
    // Populate teams for response
    await user.populate('teams', 'name color icon permissions');

    res.status(201).json({
      message: 'User created successfully.',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Admin create user error:', error);
    res.status(500).json({
      message: 'Failed to create user.'
    });
  }
});

// @route   PATCH /api/admin/users/:id/roles
// @desc    Update user roles
// @access  Private (admin)
router.patch('/users/:id/roles', [
  body('roles')
    .isArray({ min: 1 })
    .withMessage('Roles must be provided as a non-empty array.')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { roles } = req.body;

    const normalizedRoles = roles
      .filter(role => typeof role === 'string')
      .map(role => role.toLowerCase().trim());

    const sanitizedRoles = [...new Set(
      normalizedRoles.filter(role => ROLE_VALUES.includes(role))
    )];

    if (!sanitizedRoles.length) {
      return res.status(400).json({
        message: 'At least one valid role must be assigned.'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    const wasAdmin = user.roles.includes('admin');
    const willBeAdmin = sanitizedRoles.includes('admin');

    if (wasAdmin && !willBeAdmin) {
      const otherAdmins = await User.countDocuments({
        roles: 'admin',
        _id: { $ne: user._id }
      });

      if (otherAdmins === 0) {
        return res.status(400).json({
          message: 'At least one administrator is required. Assign admin role to another user before removing it here.'
        });
      }
    }

    user.roles = sanitizedRoles;
    await user.save();

    res.json({
      message: 'User roles updated successfully.',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Admin update roles error:', error);
    res.status(500).json({
      message: 'Failed to update user roles.'
    });
  }
});

// @route   PATCH /api/admin/users/:id/teams
// @desc    Update user teams
// @access  Private (admin)
router.patch('/users/:id/teams', [
  body('teams')
    .isArray()
    .withMessage('Teams must be provided as an array.')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { teams } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    // Validate teams
    const validTeams = await Team.find({ _id: { $in: teams }, isActive: true });
    const teamIds = validTeams.map(t => t._id);

    user.teams = teamIds;
    await user.save();

    await user.populate('teams', 'name color icon permissions');

    res.json({
      message: 'User teams updated successfully.',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Admin update teams error:', error);
    res.status(500).json({
      message: 'Failed to update user teams.'
    });
  }
});

// @route   PATCH /api/admin/users/:id/permissions
// @desc    Update user custom permissions
// @access  Private (admin)
router.patch('/users/:id/permissions', [
  body('permissions')
    .isArray()
    .withMessage('Permissions must be provided as an array.')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { permissions } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    // Validate permissions
    const validPermissions = Team.AVAILABLE_PERMISSIONS;
    const sanitizedPermissions = [...new Set(
      permissions.filter(p => validPermissions.includes(p))
    )];

    user.customPermissions = sanitizedPermissions;
    await user.save();

    await user.populate('teams', 'name color icon permissions');

    res.json({
      message: 'User permissions updated successfully.',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Admin update permissions error:', error);
    res.status(500).json({
      message: 'Failed to update user permissions.'
    });
  }
});

// @route   PATCH /api/admin/users/:id
// @desc    Update user information
// @access  Private (admin)
router.patch('/users/:id', [
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .optional()
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('First name must be less than 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Last name must be less than 50 characters'),
  body('roles')
    .optional()
    .isArray()
    .withMessage('Roles must be an array'),
  body('teams')
    .optional()
    .isArray()
    .withMessage('Teams must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { email, password, firstName, lastName, roles, teams } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    // Update email if provided and different
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          message: 'User with this email already exists.'
        });
      }
      user.email = email;
    }

    // Update password if provided
    if (password) {
      const bcrypt = require('bcryptjs');
      user.password = password; // Will be hashed by pre-save hook
    }

    // Update name if provided
    if (firstName !== undefined) user.firstName = firstName.trim();
    if (lastName !== undefined) user.lastName = lastName.trim();

    // Update roles if provided
    if (roles !== undefined) {
      const sanitizedRoles = [...new Set(
        roles
          .filter(role => typeof role === 'string')
          .map(role => role.toLowerCase().trim())
          .filter(role => ROLE_VALUES.includes(role))
      )];
      
      if (!sanitizedRoles.length) {
        return res.status(400).json({
          message: 'At least one valid role must be assigned.'
        });
      }

      const wasAdmin = user.roles.includes('admin');
      const willBeAdmin = sanitizedRoles.includes('admin');

      if (wasAdmin && !willBeAdmin) {
        const otherAdmins = await User.countDocuments({
          roles: 'admin',
          _id: { $ne: user._id }
        });

        if (otherAdmins === 0) {
          return res.status(400).json({
            message: 'At least one administrator is required. Assign admin role to another user before removing it here.'
          });
        }
      }

      user.roles = sanitizedRoles;
    }

    // Update teams if provided
    if (teams !== undefined) {
      const validTeams = await Team.find({ _id: { $in: teams }, isActive: true });
      user.teams = validTeams.map(t => t._id);
    }

    await user.save();
    await user.populate('teams', 'name color icon permissions');

    res.json({
      message: 'User updated successfully.',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({
      message: 'Failed to update user.'
    });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete a user
// @access  Private (admin)
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    // Prevent deleting the last admin
    if (user.roles.includes('admin')) {
      const otherAdmins = await User.countDocuments({
        roles: 'admin',
        _id: { $ne: user._id }
      });

      if (otherAdmins === 0) {
        return res.status(400).json({
          message: 'Cannot delete the last administrator. Assign admin role to another user first.'
        });
      }
    }

    await User.findByIdAndDelete(id);

    res.json({
      message: 'User deleted successfully.'
    });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({
      message: 'Failed to delete user.'
    });
  }
});

// @route   GET /api/admin/tasks
// @desc    Get all tasks (admin view)
// @access  Private (admin)
router.get('/tasks', async (req, res) => {
  try {
    const { 
      status, 
      priority, 
      userId,
      page = 1, 
      limit = 50, 
      sortBy = 'createdAt', 
      sortOrder = 'desc',
      search
    } = req.query;
    
    const filter = { isArchived: false };
    
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    
    // Handle userId filter - check both assignees and user field
    if (userId) {
      const userIdObj = mongoose.Types.ObjectId.isValid(userId) 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
      filter.$or = [
        { assignees: userIdObj },
        { user: userIdObj }
      ];
    }
    
    if (search) {
      // Combine search with userId filter if both exist
      const searchFilter = {
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      };
      
      if (filter.$or) {
        // If userId filter exists, combine with search
        filter.$and = [
          { $or: filter.$or },
          searchFilter
        ];
        delete filter.$or;
      } else {
        filter.$or = searchFilter.$or;
      }
    }
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    // Use aggregation with allowDiskUse option
    // Move sort after lookup to optimize, but still need allowDiskUse for large sorts
    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'user',
          pipeline: [
            {
              $project: {
                firstName: 1,
                lastName: 1,
                email: 1
              }
            }
          ]
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assignees',
          foreignField: '_id',
          as: 'assignees',
          pipeline: [
            {
              $project: {
                firstName: 1,
                lastName: 1,
                email: 1
              }
            }
          ]
        }
      },
      { $sort: sortOptions },
      { $skip: (page - 1) * limit },
      { $limit: limit * 1 },
      {
        $project: {
          __v: 0
        }
      }
    ];
    
    // Use aggregation with allowDiskUse option to handle large sorts
    // allowDiskUse must be passed as an option to aggregate(), not as a cursor method
    const tasks = await mongoose.connection.db.collection('tasks').aggregate(pipeline, {
      allowDiskUse: true
    }).toArray();
    
    // Transform user data to match populate format and convert ObjectIds to strings
    const transformedTasks = tasks.map(task => ({
      ...task,
      _id: task._id.toString(),
      user: task.user ? {
        _id: task.user._id.toString(),
        firstName: task.user.firstName,
        lastName: task.user.lastName,
        email: task.user.email
      } : null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }));
    
    const total = await Task.countDocuments(filter);
    
    res.json({
      tasks: transformedTasks,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Admin get tasks error:', error);
    res.status(500).json({
      message: 'Failed to fetch tasks.'
    });
  }
});

// @route   GET /api/admin/tasks/stats
// @desc    Get task statistics
// @access  Private (admin)
router.get('/tasks/stats', async (req, res) => {
  try {
    const totalTasks = await Task.countDocuments({ isArchived: false });
    const pendingTasks = await Task.countDocuments({ status: 'pending', isArchived: false });
    const inProgressTasks = await Task.countDocuments({ status: 'in-progress', isArchived: false });
    const completedTasks = await Task.countDocuments({ status: 'completed', isArchived: false });
    const cancelledTasks = await Task.countDocuments({ status: 'cancelled', isArchived: false });
    
    const tasksByPriority = await Task.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);
    
    const tasksByUser = await Task.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
      { $unwind: '$userInfo' },
      { $project: { 
        userId: '$_id',
        count: 1,
        userName: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
        userEmail: '$userInfo.email'
      }},
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    res.json({
      overview: {
        total: totalTasks,
        pending: pendingTasks,
        inProgress: inProgressTasks,
        completed: completedTasks,
        cancelled: cancelledTasks
      },
      byPriority: tasksByPriority,
      byUser: tasksByUser
    });
  } catch (error) {
    console.error('Admin get task stats error:', error);
    res.status(500).json({
      message: 'Failed to fetch task statistics.'
    });
  }
});

// @route   PATCH /api/admin/tasks/:id/assign
// @desc    Assign a task to a user
// @access  Private (admin)
router.patch('/tasks/:id/assign', [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { userId } = req.body;

    const task = await Task.findById(id);
    if (!task) {
      return res.status(404).json({
        message: 'Task not found.'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: 'User not found.'
      });
    }

    const previousUser = task.user;
    task.user = userId;
    
    // Add to history
    task.history.push({
      action: 'assigned',
      actor: req.user._id,
      changes: {
        previousUser: previousUser,
        newUser: userId,
        assignedBy: req.user._id
      },
      timestamp: new Date()
    });

    await task.save();
    await task.populate('user', 'firstName lastName email');

    res.json({
      message: 'Task assigned successfully.',
      task
    });
  } catch (error) {
    console.error('Admin assign task error:', error);
    res.status(500).json({
      message: 'Failed to assign task.'
    });
  }
});

// @route   PATCH /api/admin/tasks/:id
// @desc    Update a task (admin can update any task)
// @access  Private (admin)
router.patch('/tasks/:id', [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be less than 200 characters'),
  body('status')
    .optional()
    .isIn(['pending', 'in-progress', 'completed', 'cancelled'])
    .withMessage('Invalid status'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Invalid priority')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed.',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const updates = req.body;

    const task = await Task.findById(id);
    if (!task) {
      return res.status(404).json({
        message: 'Task not found.'
      });
    }

    // Track changes
    const changes = {};
    Object.keys(updates).forEach(key => {
      if (key !== 'history' && task[key] !== updates[key]) {
        changes[key] = { from: task[key], to: updates[key] };
      }
    });

    Object.assign(task, updates);
    
    // Add to history if there are changes
    if (Object.keys(changes).length > 0) {
      task.history.push({
        action: 'updated',
        actor: req.user._id,
        changes: changes,
        timestamp: new Date()
      });
    }

    await task.save();
    await task.populate('user', 'firstName lastName email');

    res.json({
      message: 'Task updated successfully.',
      task
    });
  } catch (error) {
    console.error('Admin update task error:', error);
    res.status(500).json({
      message: 'Failed to update task.'
    });
  }
});

module.exports = router;

