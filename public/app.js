/**
 * Orchestr Frontend Application
 * "Conducting harmony from chaos"
 */

(function () {
  'use strict';

  // --- State Management ---
  const state = {
    token: localStorage.getItem('orchestr_token') || '',
    user: null,
    seller: null,
    activeView: 'dashboard',
    channels: [],
    orders: [],
    products: [],
    theme: localStorage.getItem('orchestr_theme') || 'dark',
  };

  // API Base Helper
  async function apiRequest(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
      const response = await fetch(endpoint, { ...options, headers });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'API request failed');
      }
      return data;
    } catch (err) {
      console.warn(`[API Error] ${endpoint}:`, err.message);
      throw err;
    }
  }

  // --- Theme Manager ---
  function initTheme() {
    applyTheme(state.theme);

    // Watch for system color scheme changes if set to auto
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.theme === 'auto') {
        applyTheme('auto');
      }
    });

    window.toggleAppTheme = function () {
      const isCurrentlyDark = state.theme === 'dark' || document.body.classList.contains('dark') || document.documentElement.classList.contains('dark') || (!document.body.classList.contains('light') && !document.documentElement.classList.contains('light'));
      const nextTheme = isCurrentlyDark ? 'light' : 'dark';
      applyTheme(nextTheme);
    };

    // Global click listener for theme toggle switches
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#themeToggleSidebar, #themeToggleMobile, .theme-toggle-switch');
      if (btn) {
        e.preventDefault();
        window.toggleAppTheme();
      }
    });

    document.getElementById('themeAutoBtn')?.addEventListener('click', () => applyTheme('auto'));
    document.getElementById('themeLightBtn')?.addEventListener('click', () => applyTheme('light'));
    document.getElementById('themeDarkBtn')?.addEventListener('click', () => applyTheme('dark'));
  }

  function applyTheme(theme) {
    state.theme = theme;
    localStorage.setItem('orchestr_theme', theme);

    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'auto' ? isSystemDark : false);

    const html = document.documentElement;
    const body = document.body;

    if (isDark) {
      html.classList.add('dark');
      html.classList.remove('light');
      body.classList.add('dark');
      body.classList.remove('light');
      html.setAttribute('data-theme', 'dark');
      body.setAttribute('data-theme', 'dark');
    } else {
      html.classList.add('light');
      html.classList.remove('dark');
      body.classList.add('light');
      body.classList.remove('dark');
      html.setAttribute('data-theme', 'light');
      body.setAttribute('data-theme', 'light');
    }

    // Sync active state on Settings Theme Picker buttons
    document.getElementById('themeAutoBtn')?.classList.toggle('active', theme === 'auto');
    document.getElementById('themeLightBtn')?.classList.toggle('active', theme === 'light');
    document.getElementById('themeDarkBtn')?.classList.toggle('active', theme === 'dark');

    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    } catch (err) {
      console.warn('[Lucide Error]', err);
    }
  }

  // --- Navigation & Views ---
  function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach((item) => {
      item.addEventListener('click', () => {
        const viewName = item.dataset.view;
        switchView(viewName);
      });
    });

    document.getElementById('viewAllOrdersBtn')?.addEventListener('click', () => switchView('orders'));
    document.getElementById('manageChannelsBtn')?.addEventListener('click', () => switchView('channels'));

    // Mobile Hamburger Toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }
  }

  function switchView(viewName) {
    state.activeView = viewName;

    // Update Nav Active State
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Update View Section Display
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.remove('active');
    });

    const targetSection = document.getElementById(`view${capitalize(viewName)}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    // Update Page Header Titles
    const titleEl = document.getElementById('pageTitle');
    const subtitleEl = document.getElementById('pageSubtitle');
    const titles = {
      dashboard: { title: 'Dashboard Overview', sub: 'Real-time status across all connected sales channels' },
      orders: { title: 'Multi-Channel Orders', sub: 'Aggregated orders from Shopify, Amazon, and Direct sites' },
      inventory: { title: 'Stock & Inventory', sub: 'Multi-channel inventory reconciliation and stock alerts' },
      channels: { title: 'Sales Channels', sub: 'Manage connected store integrations and OAuth settings' },
      settings: { title: 'Profile & Settings', sub: 'Manage store information, notifications, and theme' },
    };

    if (titles[viewName] && titleEl && subtitleEl) {
      titleEl.textContent = titles[viewName].title;
      subtitleEl.textContent = titles[viewName].sub;
    }

    // Close mobile menu
    document.getElementById('sidebar')?.classList.remove('open');

    // Refresh Data for view
    refreshData();
  }

  // --- Auth Manager ---
  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function calculatePasswordStrength(password) {
    if (!password) return { score: 0, label: 'Weak', class: 'weak' };

    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    if (score <= 1) return { score: 1, label: 'Weak (min 8 chars)', class: 'weak' };
    if (score === 2 || score === 3) return { score: 2, label: 'Medium', class: 'medium' };
    return { score: 3, label: 'Strong', class: 'strong' };
  }

  function initAuth() {
    const authModal = document.getElementById('authModal');
    const authTabsHeader = document.getElementById('authTabsHeader');
    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');

    const authForm = document.getElementById('authForm');
    const forgotPasswordForm = document.getElementById('forgotPasswordForm');
    const resetPasswordForm = document.getElementById('resetPasswordForm');

    const companyFormGroup = document.getElementById('companyFormGroup');
    const nameFormGroup = document.getElementById('nameFormGroup');
    const rememberForgotRow = document.getElementById('rememberForgotRow');
    const socialLoginWrapper = document.getElementById('socialLoginWrapper');

    const authEmail = document.getElementById('authEmail');
    const authPassword = document.getElementById('authPassword');
    const emailErrorMsg = document.getElementById('emailErrorMsg');

    const passwordStrengthWrapper = document.getElementById('passwordStrengthWrapper');
    const strengthBar = document.getElementById('strengthBar');
    const strengthText = document.getElementById('strengthText');

    const submitAuthBtn = document.getElementById('submitAuthBtn');
    const toggleText = document.getElementById('toggleText');
    const toggleModeLink = document.getElementById('toggleModeLink');

    const authErrorMsg = document.getElementById('authErrorMsg');
    const authSuccessMsg = document.getElementById('authSuccessMsg');

    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const backToLoginFromForgot = document.getElementById('backToLoginFromForgot');
    const backToLoginFromReset = document.getElementById('backToLoginFromReset');

    const socialGoogleBtn = document.getElementById('socialGoogleBtn');
    const socialGithubBtn = document.getElementById('socialGithubBtn');
    const authBtn = document.getElementById('authBtn');

    let mode = 'login'; // 'login' | 'register' | 'forgot' | 'reset'

    function showBanner(type, message) {
      if (type === 'error') {
        authErrorMsg.textContent = message;
        authErrorMsg.classList.remove('hidden');
        authSuccessMsg.classList.add('hidden');
      } else if (type === 'success') {
        authSuccessMsg.textContent = message;
        authSuccessMsg.classList.remove('hidden');
        authErrorMsg.classList.add('hidden');
      }
    }

    function clearBanners() {
      authErrorMsg.classList.add('hidden');
      authSuccessMsg.classList.add('hidden');
    }

    function setAuthMode(newMode) {
      mode = newMode;
      clearBanners();

      // Show/Hide Top Tabs & Forms
      authTabsHeader.style.display = (mode === 'login' || mode === 'register') ? 'flex' : 'none';
      authForm.classList.toggle('hidden', mode === 'forgot' || mode === 'reset');
      forgotPasswordForm.classList.toggle('hidden', mode !== 'forgot');
      resetPasswordForm.classList.toggle('hidden', mode !== 'reset');

      if (mode === 'login' || mode === 'register') {
        tabLoginBtn.classList.toggle('active', mode === 'login');
        tabRegisterBtn.classList.toggle('active', mode === 'register');

        companyFormGroup.style.display = mode === 'register' ? 'flex' : 'none';
        nameFormGroup.style.display = mode === 'register' ? 'flex' : 'none';
        passwordStrengthWrapper.classList.toggle('hidden', mode !== 'register');
        rememberForgotRow.style.display = mode === 'login' ? 'flex' : 'none';
        socialLoginWrapper.style.display = 'block';

        submitAuthBtn.textContent = mode === 'login' ? 'Log In' : 'Sign Up';
        toggleText.textContent = mode === 'login' ? "Don't have an account?" : "Already have an account?";
        toggleModeLink.textContent = mode === 'login' ? "Sign up" : "Log in";
      }
    }

    tabLoginBtn?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode('login'); });
    tabRegisterBtn?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode('register'); });
    toggleModeLink?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode(mode === 'login' ? 'register' : 'login'); });
    forgotPasswordLink?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode('forgot'); });
    backToLoginFromForgot?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode('login'); });
    backToLoginFromReset?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode('login'); });

    // Password Visibility Toggle Handler
    function setupPasswordToggle(buttonId, inputId) {
      const btn = document.getElementById(buttonId);
      const input = document.getElementById(inputId);
      if (!btn || !input) return;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const isPassword = input.getAttribute('type') === 'password';
        input.setAttribute('type', isPassword ? 'text' : 'password');
        btn.innerHTML = isPassword ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
        if (window.lucide) window.lucide.createIcons();
      });
    }

    setupPasswordToggle('toggleAuthPasswordBtn', 'authPassword');
    setupPasswordToggle('toggleResetNewPasswordBtn', 'resetNewPassword');
    setupPasswordToggle('toggleResetConfirmPasswordBtn', 'resetConfirmPassword');

    // Live Email Validation
    authEmail?.addEventListener('input', () => {
      const val = authEmail.value.trim();
      if (val && !validateEmail(val)) {
        emailErrorMsg.classList.remove('hidden');
      } else {
        emailErrorMsg.classList.add('hidden');
      }
    });

    // Live Password Strength Indicator
    authPassword?.addEventListener('input', () => {
      if (mode === 'register') {
        const val = authPassword.value;
        const res = calculatePasswordStrength(val);
        strengthBar.className = `strength-bar ${res.class}`;
        strengthText.textContent = `Password Strength: ${res.label}`;
      }
    });

    // Sign Up & Log In Form Submit
    authForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearBanners();

      const email = authEmail.value.trim();
      const password = authPassword.value;
      const name = document.getElementById('authName')?.value.trim();

      if (!validateEmail(email)) {
        showBanner('error', 'Please provide a valid email address.');
        return;
      }

      if (mode === 'register' && password.length < 8) {
        showBanner('error', 'Password must be at least 8 characters long.');
        return;
      }

      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login' ? { email, password } : { email, password, name };

      submitAuthBtn.disabled = true;

      try {
        const data = await apiRequest(endpoint, {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (data.token) {
          state.token = data.token;
          state.user = data.user;

          // Remember me session preference
          const remember = document.getElementById('rememberMeCheckbox')?.checked;
          if (remember) {
            localStorage.setItem('orchestr_token', data.token);
          } else {
            sessionStorage.setItem('orchestr_token', data.token);
          }

          authModal.classList.add('hidden');
          updateUserUI();
          refreshData();
        }
      } catch (err) {
        showBanner('error', err.message || 'Authentication failed. Please check your credentials.');
      } finally {
        submitAuthBtn.disabled = false;
      }
    });

    // Forgot Password Form Submit
    forgotPasswordForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearBanners();
      const email = document.getElementById('forgotEmail').value.trim();
      const submitBtn = document.getElementById('submitForgotBtn');

      submitBtn.disabled = true;
      try {
        const data = await apiRequest('/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });

        showBanner('success', data.message || 'Check your email for reset instructions.');

        if (data.resetToken) {
          // Pre-fill reset form token for seamless development demo
          document.getElementById('resetTokenInput').value = data.resetToken;
          setTimeout(() => setAuthMode('reset'), 1500);
        }
      } catch (err) {
        showBanner('error', err.message || 'Failed to request password reset.');
      } finally {
        submitBtn.disabled = false;
      }
    });

    // Reset Password Form Submit
    resetPasswordForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearBanners();
      const token = document.getElementById('resetTokenInput').value.trim();
      const newPassword = document.getElementById('resetNewPassword').value;
      const confirmPassword = document.getElementById('resetConfirmPassword').value;
      const submitBtn = document.getElementById('submitResetBtn');

      if (newPassword.length < 8) {
        showBanner('error', 'New password must be at least 8 characters long.');
        return;
      }

      if (newPassword !== confirmPassword) {
        showBanner('error', 'Passwords do not match.');
        return;
      }

      submitBtn.disabled = true;
      try {
        const data = await apiRequest('/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token, newPassword }),
        });

        setAuthMode('login');
        showBanner('success', data.message || 'Password reset successfully. Please log in.');
      } catch (err) {
        showBanner('error', err.message || 'Failed to reset password.');
      } finally {
        submitBtn.disabled = false;
      }
    });

    // Social Login Buttons Mock Handlers
    socialGoogleBtn?.addEventListener('click', () => handleSocialLogin('Google'));
    socialGithubBtn?.addEventListener('click', () => handleSocialLogin('GitHub'));

    async function handleSocialLogin(provider) {
      clearBanners();
      try {
        const mockEmail = `seller.${provider.toLowerCase()}@example.com`;
        const mockName = `${provider} Merchant`;

        const data = await apiRequest('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email: mockEmail, password: 'SocialAuthPassword123!', name: mockName }),
        }).catch(() =>
          apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: mockEmail, password: 'SocialAuthPassword123!' }),
          })
        );

        if (data.token) {
          state.token = data.token;
          state.user = data.user;
          localStorage.setItem('orchestr_token', data.token);
          authModal.classList.add('hidden');
          updateUserUI();
          refreshData();
        }
      } catch (err) {
        showBanner('error', `${provider} sign-in failed: ` + err.message);
      }
    }

    authBtn?.addEventListener('click', () => {
      if (state.token) {
        // Sign out
        state.token = '';
        state.user = null;
        localStorage.removeItem('orchestr_token');
        sessionStorage.removeItem('orchestr_token');
        updateUserUI();
        setAuthMode('login');
        authModal.classList.remove('hidden');
      } else {
        setAuthMode('login');
        authModal.classList.remove('hidden');
      }
    });

    // Automatically authenticate on load if token exists
    if (!state.token) {
      authModal.classList.remove('hidden');
    } else {
      fetchSellerProfile();
    }
  }


  async function fetchSellerProfile() {
    try {
      const data = await apiRequest('/api/sellers/me');
      if (data.seller) {
        state.seller = data.seller;
        updateUserUI();
        populateProfileForm();
      }
    } catch {
      // If token expired, clear token and open login modal
      state.token = '';
      localStorage.removeItem('orchestr_token');
      document.getElementById('authModal')?.classList.remove('hidden');
    }
  }

  function updateUserUI() {
    const name = state.seller?.name || state.user?.name || 'Acme Merchant';
    const email = state.seller?.email || state.user?.email || 'seller@acme.com';

    document.getElementById('sidebarUserName').textContent = name;
    document.getElementById('sidebarUserEmail').textContent = email;
    document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
  }

  // --- Data Loading & Rendering ---
  async function refreshData() {
    await Promise.all([loadChannels(), loadOrders(), loadInventory()]);
    renderDashboard();
    renderOrders();
    renderInventory();
    renderChannels();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  async function loadChannels() {
    try {
      const data = await apiRequest('/api/channels');
      state.channels = data.channels || [];
    } catch {
      // Default fallback mock channels if API unauthenticated
      state.channels = [
        {
          id: 'chan-1',
          name: 'Acme Shopify Store',
          type: 'shopify',
          status: 'active',
          credentials: { shop_domain: 'acme-retail.myshopify.com', access_token: 'shpa****1234' },
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'chan-2',
          name: 'Amazon US Marketplace',
          type: 'amazon',
          status: 'active',
          credentials: { seller_id: 'AMZ****9988' },
          updatedAt: new Date().toISOString(),
        },
      ];
    }
  }

  async function loadOrders() {
    try {
      const statusFilter = document.getElementById('orderStatusFilter')?.value || 'all';
      const channelFilter = document.getElementById('orderChannelFilter')?.value || 'all';
      const searchVal = document.getElementById('orderSearchInput')?.value || '';

      const queryParams = new URLSearchParams();
      if (statusFilter !== 'all') queryParams.append('status', statusFilter);
      if (channelFilter !== 'all') queryParams.append('channel', channelFilter);
      if (searchVal) queryParams.append('search', searchVal);

      const data = await apiRequest(`/api/orders?${queryParams.toString()}`);
      state.orders = data.orders || [];
    } catch {
      state.orders = [];
    }
  }

  async function loadInventory() {
    // Simulated stock inventory from products
    state.products = [
      { id: 'p1', title: 'Wireless Ergonomic Mouse', sku: 'PROD-MOUSE-001', price: 49.99, inventoryQuantity: 150, status: 'active' },
      { id: 'p2', title: 'Mechanical Gaming Keyboard', sku: 'PROD-KEYBD-002', price: 129.99, inventoryQuantity: 85, status: 'active' },
      { id: 'p3', title: 'UltraWide 34-inch Monitor', sku: 'PROD-MONTR-003', price: 599.99, inventoryQuantity: 5, status: 'active' }, // Low stock (< 10)
      { id: 'p4', title: 'USB-C Multi-Port Hub', sku: 'PROD-HUB-004', price: 34.50, inventoryQuantity: 200, status: 'active' },
      { id: 'p5', title: 'Noise-Canceling Headphones', sku: 'PROD-HEADP-005', price: 199.95, inventoryQuantity: 60, status: 'active' },
    ];
  }

  // --- Render Views ---
  function renderDashboard() {
    // Update Metrics
    const activeOrders = state.orders.filter((o) => o.status === 'pending' || o.status === 'shipped').length;
    const lowStockItems = state.products.filter((p) => p.inventoryQuantity < 10).length;

    document.getElementById('dashActiveOrders').textContent = activeOrders || state.orders.length;
    document.getElementById('dashLowStockCount').textContent = lowStockItems;
    document.getElementById('dashConnectedChannels').textContent = state.channels.length;

    // Badges
    document.getElementById('navOrdersBadge').textContent = state.orders.length;
    document.getElementById('navLowStockBadge').textContent = lowStockItems;

    // Render Recent Orders Table
    const tbody = document.getElementById('dashOrdersTbody');
    if (tbody) {
      const recent = state.orders.slice(0, 5);
      tbody.innerHTML = recent
        .map(
          (o) => `
        <tr>
          <td><strong>${o.orderNumber}</strong></td>
          <td><span class="platform-badge platform-${o.channelType.toLowerCase()}">${o.channelType}</span></td>
          <td>${o.customerName}</td>
          <td>${o.itemsCount} items</td>
          <td>$${o.totalPrice.toFixed(2)}</td>
          <td>${renderStatusBadge(o.status)}</td>
          <td><small>${formatDate(o.createdAt)}</small></td>
        </tr>
      `
        )
        .join('');
    }

    // Render Channel Status Grid
    const channelsGrid = document.getElementById('dashChannelsGrid');
    if (channelsGrid) {
      channelsGrid.innerHTML = state.channels
        .map(
          (c) => `
        <div class="channel-card">
          <div class="channel-card-header">
            <div class="channel-brand">
              <span class="platform-badge platform-${c.type}">${c.type}</span>
              <strong>${c.name}</strong>
            </div>
            <span class="badge badge-${c.status === 'active' ? 'success' : 'neutral'}">${c.status}</span>
          </div>
          <div class="text-small">Last Synced: Just now</div>
        </div>
      `
        )
        .join('');
    }
  }

  function renderOrders() {
    const tbody = document.getElementById('ordersTbody');
    if (!tbody) return;

    if (state.orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem;">No orders found matching the filter criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.orders
      .map(
        (o) => `
      <tr>
        <td><strong>${o.orderNumber}</strong></td>
        <td><span class="platform-badge platform-${o.channelType.toLowerCase()}">${o.channelType}</span></td>
        <td>
          <div>${o.customerName}</div>
          <small>${o.customerEmail}</small>
        </td>
        <td>${o.itemsCount} items</td>
        <td>$${o.totalPrice.toFixed(2)}</td>
        <td>${renderStatusBadge(o.status)}</td>
        <td>
          <button class="btn btn-ghost btn-sm update-order-btn" data-id="${o.id}">
            Update Status
          </button>
        </td>
      </tr>
    `
      )
      .join('');
  }

  function renderInventory() {
    const tbody = document.getElementById('inventoryTbody');
    if (!tbody) return;

    const lowStockCount = state.products.filter((p) => p.inventoryQuantity < 10).length;
    const banner = document.getElementById('lowStockAlertBanner');
    if (banner) {
      banner.classList.toggle('hidden', lowStockCount === 0);
    }

    tbody.innerHTML = state.products
      .map(
        (p) => `
      <tr class="${p.inventoryQuantity < 10 ? 'warning-row' : ''}">
        <td><strong>${p.title}</strong></td>
        <td><code>${p.sku}</code></td>
        <td>$${p.price.toFixed(2)}</td>
        <td>
          <strong class="${p.inventoryQuantity < 10 ? 'text-warning' : ''}">
            ${p.inventoryQuantity} units
          </strong>
          ${p.inventoryQuantity < 10 ? '<span class="badge badge-warning" style="margin-left:8px;">Low Stock</span>' : ''}
        </td>
        <td><span class="badge badge-success">${p.status}</span></td>
      </tr>
    `
      )
      .join('');
  }

  function renderChannels() {
    const grid = document.getElementById('channelsListGrid');
    if (!grid) return;

    grid.innerHTML = state.channels
      .map(
        (c) => `
      <div class="card channel-card">
        <div class="channel-card-header">
          <div class="channel-brand">
            <span class="platform-badge platform-${c.type}">${c.type}</span>
            <h2>${c.name}</h2>
          </div>
          <span class="badge badge-${c.status === 'active' ? 'success' : 'warning'}">${c.status}</span>
        </div>
        <p class="text-small">Shop Domain: ${c.credentials.shop_domain || 'N/A'}</p>
        <div class="channel-actions" style="margin-top:auto; display:flex; gap:8px;">
          <button class="btn btn-secondary btn-sm sync-channel-btn" data-id="${c.id}">
            <i data-lucide="refresh-cw"></i> Sync Products
          </button>
        </div>
      </div>
    `
      )
      .join('');

    // Attach sync button listeners
    document.querySelectorAll('.sync-channel-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader"></i> Syncing...';
        try {
          await apiRequest(`/api/channels/${id}/sync`, { method: 'POST' });
          alert('Shopify products synced successfully!');
          refreshData();
        } catch (err) {
          alert('Sync failed: ' + err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  // --- Channel Connect & OAuth ---
  function initChannelModals() {
    const modal = document.getElementById('channelModal');
    const openBtn = document.getElementById('openAddChannelBtn');
    const closeBtn = document.getElementById('closeChannelModalBtn');
    const cancelBtn = document.getElementById('cancelChannelBtn');
    const form = document.getElementById('connectShopifyForm');

    openBtn?.addEventListener('click', () => modal.classList.remove('hidden'));
    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
    cancelBtn?.addEventListener('click', () => modal.classList.add('hidden'));

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const shopDomain = document.getElementById('shopifyStoreDomain').value.trim();
      const submitBtn = document.getElementById('submitShopifyAuthBtn');
      submitBtn.disabled = true;

      try {
        const data = await apiRequest('/api/channels', {
          method: 'POST',
          body: JSON.stringify({ platform: 'shopify', shop: shopDomain }),
        });

        if (data.authUrl) {
          // Open OAuth URL or simulate callback in dev
          const confirmRedirect = confirm(`Initiating Shopify OAuth flow. Redirect to:\n${data.authUrl}?`);
          if (confirmRedirect) {
            window.location.href = data.authUrl;
          }
        } else if (data.channel) {
          modal.classList.add('hidden');
          refreshData();
        }
      } catch (err) {
        alert('Failed to initiate channel connection: ' + err.message);
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // --- Profile Settings ---
  function populateProfileForm() {
    if (!state.seller) return;
    document.getElementById('profName').value = state.seller.name || '';
    document.getElementById('profEmail').value = state.seller.email || '';
    document.getElementById('profCompany').value = state.seller.companyName || '';
    document.getElementById('profTimezone').value = state.seller.timezone || 'UTC';

    const prefs = state.seller.notificationPreferences || {};
    document.getElementById('prefEmailAlerts').checked = prefs.email_alerts !== false;
    document.getElementById('prefOrderUpdates').checked = prefs.order_updates !== false;
  }

  function initProfileSettings() {
    const form = document.getElementById('profileForm');
    const msg = document.getElementById('profileSuccessMsg');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('profName').value.trim();
      const companyName = document.getElementById('profCompany').value.trim();
      const timezone = document.getElementById('profTimezone').value;
      const emailAlerts = document.getElementById('prefEmailAlerts').checked;
      const orderUpdates = document.getElementById('prefOrderUpdates').checked;

      try {
        const data = await apiRequest('/api/sellers/me', {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            companyName,
            timezone,
            notificationPreferences: { email_alerts: emailAlerts, order_updates: orderUpdates },
          }),
        });

        if (data.seller) {
          state.seller = data.seller;
          updateUserUI();
          msg?.classList.remove('hidden');
          setTimeout(() => msg?.classList.add('hidden'), 3000);
        }
      } catch (err) {
        alert('Failed to save profile: ' + err.message);
      }
    });

    // Theme Switchers
    document.getElementById('themeToggleSidebar')?.addEventListener('click', toggleThemeMode);
    document.getElementById('themeToggleMobile')?.addEventListener('click', toggleThemeMode);

    document.getElementById('themeAutoBtn')?.addEventListener('click', () => applyTheme('auto'));
    document.getElementById('themeLightBtn')?.addEventListener('click', () => applyTheme('light'));
    document.getElementById('themeDarkBtn')?.addEventListener('click', () => applyTheme('dark'));
  }

  function toggleThemeMode() {
    const currentIsDark = document.body.classList.contains('dark');
    applyTheme(currentIsDark ? 'light' : 'dark');
  }

  // --- Filter Listeners ---
  function initFilterListeners() {
    document.getElementById('orderStatusFilter')?.addEventListener('change', loadOrdersAndRender);
    document.getElementById('orderChannelFilter')?.addEventListener('change', loadOrdersAndRender);
    document.getElementById('orderSearchInput')?.addEventListener('input', debounce(loadOrdersAndRender, 300));

    document.getElementById('globalSyncBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('globalSyncBtn');
      btn.disabled = true;
      try {
        await refreshData();
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function loadOrdersAndRender() {
    await loadOrders();
    renderOrders();
    if (window.lucide) window.lucide.createIcons();
  }

  // --- Helpers ---
  function renderStatusBadge(status) {
    const s = (status || '').toLowerCase();
    let badgeClass = 'badge-neutral';
    if (s === 'delivered') badgeClass = 'badge-success';
    if (s === 'pending') badgeClass = 'badge-warning';
    if (s === 'shipped') badgeClass = 'badge-accent';
    if (s === 'cancelled') badgeClass = 'badge-error';
    return `<span class="badge ${badgeClass}">${capitalize(s)}</span>`;
  }

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // --- App Initialization ---
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNavigation();
    initAuth();
    initChannelModals();
    initProfileSettings();
    initFilterListeners();
    refreshData();
  });
})();
