-- Panopticon Chat Application - Database Schema
-- PostgreSQL 12+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'superadmin')),
    is_shadow_banned BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

-- Messages Table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_soft_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE,
    deleted_by UUID REFERENCES users(id),
    was_shadow_banned BOOLEAN NOT NULL DEFAULT false, -- Track if message was shadow banned
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT no_self_message CHECK (sender_id != receiver_id)
);

-- Logs Table (Comprehensive Audit Trail)
CREATE TABLE logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL, -- 'LOGIN', 'LOGOUT', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'USER_BANNED', 'USER_UNBANNED', 'ROLE_CHANGED', etc.
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- For admin actions on other users
    target_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB, -- Flexible field for additional context
    severity VARCHAR(20) DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Performance
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_shadow_banned ON users(is_shadow_banned);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);

CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_receiver_id ON messages(receiver_id);
CREATE INDEX idx_messages_is_soft_deleted ON messages(is_soft_deleted);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_conversation ON messages(sender_id, receiver_id, created_at DESC);

CREATE INDEX idx_logs_user_id ON logs(user_id);
CREATE INDEX idx_logs_action_type ON logs(action_type);
CREATE INDEX idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX idx_logs_target_user_id ON logs(target_user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Initial SuperAdmin User (Password: SuperAdmin123! - CHANGE IN PRODUCTION)
-- Password hash generated using bcrypt with 10 rounds
INSERT INTO users (username, email, password_hash, role) VALUES
('superadmin', 'superadmin@panopticon.local', '$2b$10$rGKJ8VqZ6QxZ9Z3vY5X5xuJhKj8WxKj8WxKj8WxKj8WxKj8WxKj8W', 'superadmin');

-- Log the superadmin creation
INSERT INTO logs (user_id, action_type, severity, metadata) 
SELECT id, 'SUPERADMIN_CREATED', 'CRITICAL', '{"note": "Initial superadmin account created"}'::jsonb
FROM users WHERE username = 'superadmin';

CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mimetype VARCHAR(100) NOT NULL,
    size INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add index
CREATE INDEX idx_attachments_message_id ON attachments(message_id);

-- Add column to messages table to indicate if it has attachments
ALTER TABLE messages ADD COLUMN has_attachment BOOLEAN DEFAULT false;