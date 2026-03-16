const mongoose = require('mongoose');
require('dotenv').config();
const Team = require('../models/Team');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/taskmanagement';

const defaultTeams = [
  {
    name: 'Administrator',
    description: 'Full system access with all permissions',
    color: '#1d4ed8',
    icon: 'crown',
    isSystem: true,
    permissions: ['admin.access']
  },
  {
    name: 'Manager',
    description: 'Can manage teams and high-priority work',
    color: '#047857',
    icon: 'clipboard-list',
    isSystem: true,
    permissions: [
      'tasks.create',
      'tasks.read',
      'tasks.update',
      'tasks.delete',
      'tasks.assign',
      'users.read',
      'teams.read',
      'settings.read'
    ]
  },
  {
    name: 'Member',
    description: 'Standard workspace access for task collaborators',
    color: '#4338ca',
    icon: 'users',
    isSystem: true,
    permissions: [
      'tasks.create',
      'tasks.read',
      'tasks.update'
    ]
  }
];

async function initDefaultTeams() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    for (const teamData of defaultTeams) {
      const existingTeam = await Team.findOne({ name: teamData.name });
      if (!existingTeam) {
        const team = new Team(teamData);
        await team.save();
        console.log(`✅ Created team: ${teamData.name}`);
      } else {
        console.log(`⏭️  Team already exists: ${teamData.name}`);
      }
    }

    console.log('✅ Default teams initialization complete');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing default teams:', error);
    process.exit(1);
  }
}

initDefaultTeams();

