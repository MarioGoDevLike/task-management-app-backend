const express = require('express');
const { body, validationResult } = require('express-validator');
const Task = require('../models/Task');
const User = require('../models/User');
const auth = require('../middleware/auth');
const checkPermission = require('../middleware/checkPermission');

const router = express.Router();

// @route   GET /api/tasks
// @desc    Get all tasks for authenticated user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { status, priority, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    // Find tasks where user is in assignees array OR user field matches (for backward compatibility)
    const filter = { 
      $or: [
        { assignees: req.user._id },
        { user: req.user._id }
      ],
      isArchived: false 
    };
    
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const tasks = await Task.find(filter)
      .populate('assignees', 'firstName lastName email')
      .populate('user', 'firstName lastName email')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');
    
    const total = await Task.countDocuments(filter);
    
    res.json({
      tasks,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/tasks
// @desc    Create a new task
// @access  Private
router.post('/', [
  auth,
  checkPermission('tasks.create'),
  body('title')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title is required and must be less than 200 characters'),
  body('description')
    .optional({ values: 'falsy' }),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Priority must be low, medium, high, or urgent'),
  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Due date must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Initialize assignees array with creator if not provided
    const assignees = req.body.assignees || [];
    if (!assignees.includes(req.user._id)) {
      assignees.push(req.user._id);
    }

    const task = new Task({
      ...req.body,
      user: req.user._id, // Keep for backward compatibility
      assignees: assignees,
      history: [{ action: 'created', actor: req.user._id, changes: req.body }]
    });

    await task.save();
    await task.populate('assignees', 'firstName lastName email');
    await task.populate('user', 'firstName lastName email');
    
    // Emit socket event for task creation
    const io = req.app.get('io');
    if (io) {
      // Notify the creator
      io.to(`user:${req.user._id}`).emit('task:created', task);
      // Notify all assignees
      task.assignees.forEach(assignee => {
        if (assignee._id.toString() !== req.user._id.toString()) {
          io.to(`user:${assignee._id}`).emit('task:created', task);
        }
      });
      // Notify admins
      io.to('admin').emit('task:created', task);
    }
    
    res.status(201).json(task);
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/tasks/:id
// @desc    Get a specific task
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findOne({ 
      _id: req.params.id, 
      $or: [
        { assignees: req.user._id },
        { user: req.user._id }
      ]
    });
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    
    await task.populate('assignees', 'firstName lastName email');
    await task.populate('user', 'firstName lastName email');
    res.json(task);
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/tasks/:id
// @desc    Update a task
// @access  Private
router.put('/:id', [
  auth,
  checkPermission('tasks.update'),
  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be less than 200 characters'),
  body('description')
    .optional({ values: 'falsy' }),
  body('status')
    .optional()
    .isIn(['pending', 'in-progress', 'completed', 'cancelled'])
    .withMessage('Status must be pending, in-progress, completed, or cancelled'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Priority must be low, medium, high, or urgent')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const existing = await Task.findOne({ 
      _id: req.params.id, 
      $or: [
        { assignees: req.user._id },
        { user: req.user._id }
      ]
    });
    if (!existing) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const updates = req.body;
    const changes = {};
    for (const k of Object.keys(updates)) {
      if (k === 'assignees' && Array.isArray(updates[k])) {
        // Handle assignees array update
        const oldAssignees = existing.assignees ? existing.assignees.map(a => a.toString()) : [];
        const newAssignees = updates[k].map(a => a.toString());
        if (JSON.stringify(oldAssignees.sort()) !== JSON.stringify(newAssignees.sort())) {
          changes[k] = { from: oldAssignees, to: newAssignees };
          existing.assignees = updates[k];
        }
      } else if (String(existing[k]) !== String(updates[k])) {
        changes[k] = { from: existing[k], to: updates[k] };
        existing[k] = updates[k];
      }
    }

    if (Object.keys(changes).length > 0) {
      existing.history.push({ action: 'updated', actor: req.user._id, changes });
    }

    const task = await existing.save();
    await task.populate('assignees', 'firstName lastName email');
    await task.populate('user', 'firstName lastName email');
    
    // Emit socket event for task update
    const io = req.app.get('io');
    if (io) {
      // Notify all assignees
      task.assignees.forEach(assignee => {
        io.to(`user:${assignee._id}`).emit('task:updated', task);
      });
      // Notify original user if different
      if (task.user && task.user._id) {
        const userIdStr = task.user._id.toString();
        if (!task.assignees.some(a => a._id.toString() === userIdStr)) {
          io.to(`user:${userIdStr}`).emit('task:updated', task);
        }
      }
      // Notify admins
      io.to('admin').emit('task:updated', task);
    }
    
    res.json(task);
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/tasks/:id
// @desc    Delete a task
// @access  Private
router.delete('/:id', auth, checkPermission('tasks.delete'), async (req, res) => {
  try {
    const task = await Task.findOne({ 
      _id: req.params.id, 
      $or: [
        { assignees: req.user._id },
        { user: req.user._id }
      ]
    });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    if (!task.isArchived) {
      task.isArchived = true;
      task.history.push({ action: 'archived', actor: req.user._id });
      await task.save();
    }
    res.json({ message: 'Task archived successfully' });
  } catch (error) {
    console.error('Archive task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Restore archived task
router.post('/:id/restore', auth, async (req, res) => {
  try {
    const task = await Task.findOne({ 
      _id: req.params.id, 
      $or: [
        { assignees: req.user._id },
        { user: req.user._id }
      ]
    });
    if (!task) return res.status(404).json({ message: 'Task not found' });
    if (task.isArchived) {
      task.isArchived = false;
      task.history.push({ action: 'restored', actor: req.user._id });
      await task.save();
    }
    await task.populate('assignees', 'firstName lastName email');
    await task.populate('user', 'firstName lastName email');
    res.json(task);
  } catch (error) {
    console.error('Restore task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Task history
router.get('/:id/history', auth, async (req, res) => {
  try {
    const task = await Task.findOne({ 
      _id: req.params.id, 
      $or: [
        { assignees: req.user._id },
        { user: req.user._id }
      ]
    }).select('history');
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json({ history: task.history });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/tasks/:id/assign
// @desc    Assign/update assignees for a task
// @access  Private
router.patch('/:id/assign', [
  auth,
  checkPermission('tasks.assign'),
  body('assignees')
    .isArray()
    .withMessage('Assignees must be an array')
    .optional(),
  body('assignees.*')
    .isMongoId()
    .withMessage('Each assignee must be a valid user ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { assignees } = req.body;

    // Find task - user must be assigned to it or have admin access
    const task = await Task.findById(id);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Check if user is assigned to the task or is admin
    const isAdmin = req.user.roles && req.user.roles.includes('admin');
    const isAssigned = task.assignees && task.assignees.some(a => a.toString() === req.user._id.toString());
    const isOwner = task.user && task.user.toString() === req.user._id.toString();
    
    if (!isAdmin && !isAssigned && !isOwner) {
      return res.status(403).json({ 
        message: 'You can only assign tasks that you are assigned to' 
      });
    }

    // Validate all assignees exist
    if (assignees && assignees.length > 0) {
      const users = await User.find({ _id: { $in: assignees } });
      if (users.length !== assignees.length) {
        return res.status(400).json({ message: 'One or more assignees not found' });
      }
    }

    // Initialize assignees array if it doesn't exist
    if (!task.assignees) {
      task.assignees = [];
      // Migrate user to assignees if exists
      if (task.user && !task.assignees.some(a => a.toString() === task.user.toString())) {
        task.assignees.push(task.user);
      }
    }

    const previousAssignees = task.assignees.map(a => a.toString());
    const newAssignees = assignees || [];
    const newAssigneesStr = newAssignees.map(a => a.toString());
    
    // Update assignees array
    task.assignees = newAssignees;
    
    // Add to history
    task.history.push({
      action: 'assignees_updated',
      actor: req.user._id,
      changes: {
        previousAssignees: previousAssignees,
        newAssignees: newAssigneesStr,
        updatedBy: req.user._id
      },
      timestamp: new Date()
    });

    await task.save();
    await task.populate('assignees', 'firstName lastName email');
    await task.populate('user', 'firstName lastName email');

    // Emit socket event for assignee update
    const io = req.app.get('io');
    if (io) {
      // Notify all assignees (old and new)
      const allAssigneeIds = new Set();
      previousAssignees.forEach(id => allAssigneeIds.add(id.toString()));
      newAssignees.forEach(id => allAssigneeIds.add(id.toString()));
      
      allAssigneeIds.forEach(assigneeId => {
        io.to(`user:${assigneeId}`).emit('task:updated', task);
      });
      // Notify original user if different
      if (task.user && task.user._id) {
        const userIdStr = task.user._id.toString();
        if (!allAssigneeIds.has(userIdStr)) {
          io.to(`user:${userIdStr}`).emit('task:updated', task);
        }
      }
      // Notify admins
      io.to('admin').emit('task:updated', task);
    }

    res.json({
      message: 'Task assignees updated successfully',
      task
    });
  } catch (error) {
    console.error('Assign task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

