import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export interface DbQuerier {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface AuthPayload {
  userId: string;
  sellerId: string;
  email: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  seller_id?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export class AuthService {
  private static getJwtSecret(): string {
    return process.env.JWT_SECRET || 'orchestr_dev_jwt_secret_key_2026';
  }

  private static getJwtExpiresIn(): string {
    return process.env.JWT_EXPIRES_IN || '24h';
  }

  /**
   * Hashes a plain text password using bcrypt.
   */
  public static async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Compares a plain text password against a bcrypt hash.
   */
  public static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generates a signed JWT token containing userId, sellerId, and email.
   */
  public static generateToken(payload: AuthPayload): string {
    const secret = this.getJwtSecret();
    const expiresIn = this.getJwtExpiresIn();
    return jwt.sign(payload, secret, { expiresIn: expiresIn as any });
  }

  /**
   * Verifies and decodes a JWT token.
   */
  public static verifyToken(token: string): AuthPayload {
    const secret = this.getJwtSecret();
    return jwt.verify(token, secret) as AuthPayload;
  }

  /**
   * Registers a new user. Creates a seller record if seller_id is not provided.
   */
  public static async registerUser(db: DbQuerier, input: RegisterInput) {
    const { email, password, name, seller_id } = input;

    if (!email || !password) {
      const error: any = new Error('Email and password are required');
      error.statusCode = 400;
      throw error;
    }

    if (password.length < 6) {
      const error: any = new Error('Password must be at least 6 characters long');
      error.statusCode = 400;
      throw error;
    }

    // Check if user already exists
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existingUser.rows.length > 0) {
      const error: any = new Error('User already exists with this email');
      error.statusCode = 400;
      throw error;
    }

    let finalSellerId = seller_id;

    // If no seller_id provided, automatically create a seller for this user
    if (!finalSellerId) {
      const sellerName = name || email.split('@')[0] + ' Store';
      const sellerResult = await db.query(
        `INSERT INTO sellers (name, email)
         VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [sellerName, email.toLowerCase().trim()]
      );
      finalSellerId = sellerResult.rows[0].id;
    }

    // Hash password
    const passwordHash = await this.hashPassword(password);

    // Insert user
    const insertResult = await db.query(
      `INSERT INTO users (email, name, password_hash, seller_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, seller_id, created_at`,
      [email.toLowerCase().trim(), name || null, passwordHash, finalSellerId]
    );

    const user = insertResult.rows[0];

    // Generate JWT token
    const tokenPayload: AuthPayload = {
      userId: user.id,
      sellerId: user.seller_id,
      email: user.email,
    };

    const token = this.generateToken(tokenPayload);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        sellerId: user.seller_id,
        createdAt: user.created_at,
      },
    };
  }

  /**
   * Authenticates user with email and password, returning JWT token.
   */
  public static async loginUser(db: DbQuerier, input: LoginInput) {
    const { email, password } = input;

    if (!email || !password) {
      const error: any = new Error('Email and password are required');
      error.statusCode = 400;
      throw error;
    }

    // Find user by email
    const result = await db.query(
      'SELECT id, email, name, password_hash, seller_id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      const error: any = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    const user = result.rows[0];

    // Verify password
    const isPasswordValid = await this.comparePassword(password, user.password_hash);
    if (!isPasswordValid) {
      const error: any = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    let sellerId = user.seller_id;
    // If seller_id is missing for existing user, create/link seller
    if (!sellerId) {
      const sellerResult = await db.query(
        `INSERT INTO sellers (name, email)
         VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [user.name || user.email.split('@')[0] + ' Store', user.email]
      );
      sellerId = sellerResult.rows[0].id;
      await db.query('UPDATE users SET seller_id = $1 WHERE id = $2', [sellerId, user.id]);
    }

    // Generate JWT token
    const tokenPayload: AuthPayload = {
      userId: user.id,
      sellerId: sellerId,
      email: user.email,
    };

    const token = this.generateToken(tokenPayload);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        sellerId: sellerId,
      },
    };
  }

  // In-memory store for password reset tokens
  private static resetTokensMap: Map<string, { email: string; expiresAt: number }> = new Map();

  /**
   * Generates a password reset token for an email address.
   */
  public static async forgotPassword(db: DbQuerier, email: string): Promise<{ message: string; resetToken?: string }> {
    if (!email) {
      const error: any = new Error('Email is required');
      error.statusCode = 400;
      throw error;
    }

    const cleanEmail = email.toLowerCase().trim();
    const result = await db.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);

    // For security, even if email is not found, return success message
    if (result.rows.length === 0) {
      return { message: 'If an account with that email exists, password reset instructions have been sent.' };
    }

    const crypto = await import('crypto');
    const resetToken = `reset_tok_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

    this.resetTokensMap.set(resetToken, { email: cleanEmail, expiresAt });

    return {
      message: 'Password reset instructions have been sent to your email address.',
      resetToken,
    };
  }

  /**
   * Resets password using a valid reset token.
   */
  public static async resetPassword(db: DbQuerier, token: string, newPassword: string): Promise<{ message: string }> {
    if (!token || !newPassword) {
      const error: any = new Error('Token and new password are required');
      error.statusCode = 400;
      throw error;
    }

    if (newPassword.length < 8) {
      const error: any = new Error('Password must be at least 8 characters long');
      error.statusCode = 400;
      throw error;
    }

    const resetData = this.resetTokensMap.get(token);
    if (!resetData || resetData.expiresAt < Date.now()) {
      const error: any = new Error('Invalid or expired password reset token');
      error.statusCode = 400;
      throw error;
    }

    const passwordHash = await this.hashPassword(newPassword);
    await db.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, resetData.email]);

    // Clean up used token
    this.resetTokensMap.delete(token);

    return { message: 'Password has been reset successfully. Please log in with your new password.' };
  }
}

