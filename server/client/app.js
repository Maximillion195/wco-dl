// State management
const state = {
  currentType: 'dubbed',
  allAnime: [],
  filteredAnime: [],
  selectedAnime: null,
  searchQuery: '',
  listCache: {},
  batchMode: false,
  selected: new Set(),
  jobCount: 0
};

// DOM elements
const elements = {
  tabs: document.querySelectorAll('.tab'),
  searchInput: document.getElementById('search-input'),
  results: document.getElementById('results'),
  resultCount: document.getElementById('result-count'),
  loading: document.getElementById('loading'),
  emptyState: document.getElementById('empty-state'),
  errorState: document.getElementById('error-state'),
  errorMessage: document.getElementById('error-message'),
  retryButton: document.getElementById('retry-button'),
  modal: document.getElementById('download-modal'),
  modalTitle: document.getElementById('modal-title'),
  modalLink: document.getElementById('modal-link'),
  modalClose: document.querySelector('.modal-close'),
  seasonInput: document.getElementById('season-input'),
  episodeInput: document.getElementById('episode-input'),
  qualitySelect: document.getElementById('quality-select'),
  downloadAllBtn: document.getElementById('download-all-btn'),
  downloadLatestBtn: document.getElementById('download-latest-btn'),
  downloadSpecificBtn: document.getElementById('download-specific-btn'),
  downloadSingleBtn: document.getElementById('download-single-btn'),
  sonarrImportBtn: document.getElementById('sonarr-import-btn'),
  themeToggle: document.getElementById('theme-toggle'),
  themeIcon: document.querySelector('.theme-icon'),
  statusMessage: document.getElementById('status-message'),
  downloads: document.getElementById('downloads'),
  downloadsList: document.getElementById('downloads-list'),
  toolbar: document.getElementById('toolbar'),
  batchToggleBtn: document.getElementById('batch-toggle-btn'),
  batchDownloadBtn: document.getElementById('batch-download-btn'),
  batchQuality: document.getElementById('batch-quality'),
  batchQualitySelect: document.getElementById('batch-quality-select'),
  webhookForm: document.getElementById('webhook-form'),
  webhookInput: document.getElementById('webhook-input'),
  webhookAddBtn: document.getElementById('webhook-add-btn'),
  webhookList: document.getElementById('webhook-list')
};

// API endpoints. Same-origin by default; set window.WCO_API_BASE to use another server.
const API_BASE = window.WCO_API_BASE || '';
const WCO_BASE_URL = 'https://www.wcostream.tv';
const ENDPOINTS = {
  dubbed: '/get-all-dubbed-anime-names',
  subbed: '/get-all-subbed-anime-names',
  cartoon: '/get-all-cartoon-names',
  movie: '/get-all-movie-names',
  ova: '/get-all-ova-names'
};
const TYPE_LABELS = {
  dubbed: 'dubbed anime',
  subbed: 'subbed anime',
  cartoon: 'cartoons',
  movie: 'movies',
  ova: 'OVAs'
};
const MAX_RENDERED = 500;
const DEFAULT_QUALITY = '720';
// The server rejects batches larger than this.
const MAX_BATCH_SIZE = 50;
const LANGUAGES = {
  dubbed: 'dub',
  subbed: 'sub'
};

// Initialize
function init() {
  loadTheme();
  setupEventListeners();
  const hashType = location.hash.slice(1);
  if (ENDPOINTS[hashType]) {
    state.currentType = hashType;
  }
  updateTabs();
  loadAnimeList();
  refreshDownloads();
  loadWebhooks();
}

// API helper that surfaces the server's error message
async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    const error = new Error(message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// Theme management
function loadTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  elements.themeIcon.textContent = savedTheme === 'light' ? '🌙' : '☀️';
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  elements.themeIcon.textContent = newTheme === 'light' ? '🌙' : '☀️';
}

// Event listeners
function setupEventListeners() {
  // Tab switching
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.type));
  });

  // Search
  elements.searchInput.addEventListener('input', debounce(handleSearch, 200));

  // Retry
  elements.retryButton.addEventListener('click', loadAnimeList);

  // Result cards
  elements.results.addEventListener('click', (e) => {
    const card = e.target.closest('.anime-card');
    if (card) activateCard(card);
  });

  // Batch mode
  elements.batchToggleBtn.addEventListener('click', toggleBatchMode);
  elements.batchDownloadBtn.addEventListener('click', batchDownload);

  // Webhooks
  elements.webhookForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addWebhook();
  });

  // Modal
  elements.modalClose.addEventListener('click', closeModal);
  elements.modal.addEventListener('click', (e) => {
    if (e.target === elements.modal) closeModal();
  });

  // Download buttons
  elements.downloadAllBtn.addEventListener('click', () => downloadAnime('all'));
  elements.downloadLatestBtn.addEventListener('click', () => downloadAnime('latest'));
  elements.downloadSpecificBtn.addEventListener('click', () => downloadAnime('specific'));
  elements.downloadSingleBtn.addEventListener('click', () => downloadAnime('single'));
  elements.sonarrImportBtn.addEventListener('click', sonarrImport);

  // Theme toggle
  elements.themeToggle.addEventListener('click', toggleTheme);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function debounce(func, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

function updateTabs() {
  elements.tabs.forEach(tab => {
    const active = tab.dataset.type === state.currentType;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  elements.searchInput.placeholder = `Search ${TYPE_LABELS[state.currentType]}...`;
}

// Tab switching
async function switchTab(type) {
  if (state.currentType === type) return;

  state.currentType = type;
  history.replaceState(null, '', `#${type}`);
  updateTabs();

  elements.searchInput.value = '';
  state.searchQuery = '';
  // The batch language comes from the current tab, so a selection can't span tabs.
  state.selected.clear();
  updateBatchUI();
  await loadAnimeList();
}

// Search handling
function handleSearch(e) {
  state.searchQuery = e.target.value.toLowerCase().trim();
  filterAnime();
  renderResults();
}

// Filter anime based on search
function filterAnime() {
  if (!state.searchQuery) {
    state.filteredAnime = [...state.allAnime];
    return;
  }

  state.filteredAnime = state.allAnime.filter(anime =>
    anime.name.toLowerCase().includes(state.searchQuery)
  );
}

// Load anime list from API
async function loadAnimeList() {
  const type = state.currentType;
  hideError();

  if (!state.listCache[type]) {
    showLoading();
    try {
      state.listCache[type] = await apiRequest(ENDPOINTS[type]);
    } catch (error) {
      console.error('Failed to load list:', error);
      if (state.currentType === type) {
        hideLoading();
        showError(`Failed to load ${TYPE_LABELS[type]}: ${error.message}`);
      }
      return;
    }
  }

  // Ignore responses for a tab the user has already left.
  if (state.currentType !== type) return;
  hideLoading();
  state.allAnime = state.listCache[type];
  filterAnime();
  renderResults();
}

// Render results
function renderResults() {
  const total = state.allAnime.length;
  const matches = state.filteredAnime.length;
  const label = TYPE_LABELS[state.currentType];
  let count = state.searchQuery ? `${matches} of ${total} ${label}` : `${total} ${label}`;
  if (matches > MAX_RENDERED) count += ` (showing first ${MAX_RENDERED}, search to narrow down)`;
  elements.resultCount.textContent = count;

  if (matches === 0) {
    elements.results.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
    return;
  }

  elements.emptyState.classList.add('hidden');
  elements.results.classList.remove('hidden');

  const fragment = document.createDocumentFragment();
  state.filteredAnime.slice(0, MAX_RENDERED).forEach((anime, index) => {
    const card = document.createElement('div');
    card.className = 'anime-card';
    card.dataset.index = index;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateCard(card);
      }
    });

    const name = document.createElement('div');
    name.className = 'anime-name';
    name.append(...highlightMatch(anime.name, state.searchQuery));
    card.appendChild(name);
    decorateCard(card, anime);
    fragment.appendChild(card);
  });
  elements.results.replaceChildren(fragment);
}

function activateCard(card) {
  const anime = state.filteredAnime[Number(card.dataset.index)];
  if (!anime) return;
  if (state.batchMode) {
    toggleSelection(anime, card);
  } else {
    openModal(anime);
  }
}

// Batch downloads go through the show downloader, so single episodes can't be batched.
function isBatchable(anime) {
  return anime.kind !== 'episode';
}

// Applies the batch-mode selection state to a rendered card
function decorateCard(card, anime) {
  const batchable = isBatchable(anime);
  const selected = state.selected.has(anime.path);
  card.classList.toggle('selected', state.batchMode && selected);
  card.classList.toggle('unselectable', state.batchMode && !batchable);

  if (state.batchMode && batchable) {
    card.setAttribute('aria-pressed', String(selected));
  } else {
    card.removeAttribute('aria-pressed');
  }
  card.toggleAttribute('aria-disabled', state.batchMode && !batchable);
  card.title = state.batchMode && !batchable ? 'Single episodes can\'t be batch downloaded' : '';

  let checkbox = card.querySelector('.card-checkbox');
  if (state.batchMode && batchable) {
    if (!checkbox) {
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'card-checkbox';
      checkbox.tabIndex = -1;
      checkbox.setAttribute('aria-hidden', 'true');
      card.prepend(checkbox);
    }
    checkbox.checked = selected;
  } else {
    checkbox?.remove();
  }
}

function toggleBatchMode() {
  state.batchMode = !state.batchMode;
  if (!state.batchMode) state.selected.clear();
  elements.results.classList.toggle('batch-mode', state.batchMode);
  elements.results.querySelectorAll('.anime-card').forEach(card => {
    decorateCard(card, state.filteredAnime[Number(card.dataset.index)]);
  });
  updateBatchUI();
}

function toggleSelection(anime, card) {
  if (!isBatchable(anime)) return;
  if (state.selected.has(anime.path)) {
    state.selected.delete(anime.path);
  } else if (state.selected.size >= MAX_BATCH_SIZE) {
    showStatus(`A batch can contain at most ${MAX_BATCH_SIZE} titles`, 'error', 4000);
    return;
  } else {
    state.selected.add(anime.path);
  }
  decorateCard(card, anime);
  updateBatchUI();
}

function updateBatchUI() {
  const count = state.selected.size;
  elements.batchToggleBtn.textContent = state.batchMode
    ? `Cancel selection${count ? ` (${count} selected)` : ''}`
    : 'Select multiple';
  elements.batchToggleBtn.setAttribute('aria-pressed', String(state.batchMode));
  elements.batchDownloadBtn.textContent = `Download ${count} selected`;
  elements.batchDownloadBtn.classList.toggle('hidden', count === 0);
  elements.batchQuality.classList.toggle('hidden', !state.batchMode);
  elements.toolbar.classList.toggle('batch-active', state.batchMode);
}

function updateDownloadsVisibility() {
  elements.downloads.classList.toggle('hidden', state.jobCount === 0);
}

// Language is only meaningful for anime; cartoons, movies and OVAs have a single version.
function addLanguage(payload) {
  const language = LANGUAGES[state.currentType];
  if (language) payload.language = language;
  return payload;
}

async function batchDownload() {
  const names = [...state.selected];
  if (names.length === 0) return;

  const payload = addLanguage({ names, quality: elements.batchQualitySelect.value });
  elements.batchDownloadBtn.disabled = true;
  try {
    showStatus(`Starting ${names.length} downloads...`, 'info');
    const jobs = await apiRequest('/download-batch', { method: 'POST', body: JSON.stringify(payload) });
    showStatus(`Started ${jobs.length} downloads`, 'success', 3000);
    if (state.batchMode) toggleBatchMode();
    refreshDownloads();
  } catch (error) {
    console.error('Batch download error:', error);
    showStatus(`Failed to start batch download: ${error.message}`, 'error', 8000);
  } finally {
    elements.batchDownloadBtn.disabled = false;
  }
}

// Highlight search matches (returns DOM nodes so titles are never parsed as HTML)
function highlightMatch(text, query) {
  if (!query) return [text];

  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.split(regex).filter(Boolean).map(part => {
    if (part.toLowerCase() !== query) return part;
    const mark = document.createElement('span');
    mark.className = 'search-highlight';
    mark.textContent = part;
    return mark;
  });
}

// Escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Modal management
function openModal(anime) {
  if (!anime) return;
  state.selectedAnime = anime;
  const isEpisode = anime.kind === 'episode';

  elements.modalTitle.textContent = anime.name;
  elements.modalLink.href = isEpisode
    ? `${WCO_BASE_URL}/${anime.path}`
    : `${WCO_BASE_URL}/anime/${anime.path}`;
  elements.modal.querySelectorAll('.series-only').forEach(el => el.classList.toggle('hidden', isEpisode));
  elements.modal.querySelectorAll('.episode-only').forEach(el => el.classList.toggle('hidden', !isEpisode));

  elements.modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  elements.modal.classList.add('hidden');
  document.body.style.overflow = '';
  state.selectedAnime = null;
  elements.seasonInput.value = '';
  elements.episodeInput.value = '';
  elements.qualitySelect.value = DEFAULT_QUALITY;
}

// Download actions
async function downloadAnime(mode) {
  if (!state.selectedAnime) return;

  const { name, path } = state.selectedAnime;
  const season = elements.seasonInput.value.trim();
  const episode = elements.episodeInput.value.trim();
  const quality = elements.qualitySelect.value;

  let endpoint = '/download-anime';
  const payload = { name: path };

  // The single-episode endpoint only takes a name.
  if (mode !== 'single') {
    payload.quality = quality;
    addLanguage(payload);
  }

  if (mode === 'single') {
    endpoint = '/download-single-episode';
  } else if (mode === 'latest') {
    payload.newest = true;
  } else if (mode === 'specific') {
    if (season) {
      if (!/^\d+$/.test(season)) {
        showStatus('Season must be a number', 'error');
        return;
      }
      payload.season = season;
    }

    if (episode) {
      // Validate episode range (format: 1-10 or just 1)
      if (!/^\d+(-\d+)?$/.test(episode)) {
        showStatus('Episode must be a number or range (e.g., 1-10)', 'error');
        return;
      }
      payload.episode = episode;
    }
  }
  // mode === 'all' doesn't need extra parameters

  closeModal();
  try {
    showStatus(`Starting download for ${name}...`, 'info');
    await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    showStatus(`Download started for ${name}`, 'success', 3000);
    refreshDownloads();
  } catch (error) {
    console.error('Download error:', error);
    showStatus(`Failed to start download for ${name}: ${error.message}`, 'error', 8000);
  }
}

async function sonarrImport() {
  if (!state.selectedAnime) return;
  const { name, path } = state.selectedAnime;
  closeModal();

  try {
    const result = await apiRequest('/process-anime', {
      method: 'POST',
      body: JSON.stringify({ name: path })
    });
    const steps = [['Permissions', result.permissions], ['Sonarr', result.sonarr]];
    const failed = steps.some(([, step]) => step.status === 'failed');
    const summary = steps
      .map(([label, step]) => `${label}: ${step.status}${step.message ? ` (${step.message})` : ''}`)
      .join(' · ');
    showStatus(`${name}: ${summary}`, failed ? 'error' : 'success', 8000);
  } catch (error) {
    console.error('Sonarr import error:', error);
    showStatus(`Sonarr import for ${name} failed: ${error.message}`, 'error', 8000);
  }
}

// Download status panel
const DOWNLOAD_STATUS_LABELS = {
  running: 'Downloading',
  completed: 'Done',
  failed: 'Failed',
  timed_out: 'Timed out'
};
const DOWNLOAD_STATUS_ICONS = {
  running: '⏳',
  completed: '✅',
  failed: '❌',
  timed_out: '⏱️'
};
const EXIT_CODE_ERROR_RE = /^Process exited with code -?\d+$/;
let downloadsTimer;

async function refreshDownloads() {
  clearTimeout(downloadsTimer);
  let jobs;
  try {
    jobs = await apiRequest('/downloads');
  } catch (error) {
    console.error('Failed to load downloads:', error);
    downloadsTimer = setTimeout(refreshDownloads, 15000);
    return;
  }

  renderDownloads(jobs);
  if (jobs.some(job => job.status === 'running')) {
    downloadsTimer = setTimeout(refreshDownloads, 5000);
  }
}

function renderDownloads(jobs) {
  state.jobCount = jobs.length;
  updateDownloadsVisibility();
  elements.downloadsList.replaceChildren(...jobs.slice(0, 10).map(job => {
    const item = document.createElement('li');
    item.className = `download-item ${job.status}`;

    const icon = document.createElement('span');
    icon.className = 'download-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = DOWNLOAD_STATUS_ICONS[job.status] || '•';

    const title = document.createElement('span');
    title.className = 'download-title';
    const name = document.createElement('span');
    name.className = 'download-name';
    name.textContent = job.name;
    name.title = job.name;
    title.append(name, ...downloadTags(job).map(text => {
      const tag = document.createElement('span');
      tag.className = 'download-tag';
      tag.textContent = text;
      return tag;
    }));

    const status = document.createElement('span');
    status.className = 'download-status';
    status.textContent = DOWNLOAD_STATUS_LABELS[job.status] || job.status;

    item.append(icon, title, status);

    const detail = downloadDetail(job);
    if (detail) {
      const detailEl = document.createElement('span');
      detailEl.className = `download-detail ${detail.kind}`;
      detailEl.textContent = detail.text;
      detailEl.title = detail.text;
      item.append(detailEl);
    }
    return item;
  }));
}

function downloadDetail(job) {
  const lastLog = job.log[job.log.length - 1];
  switch (job.status) {
    case 'running':
      return lastLog ? { kind: 'log', text: lastLog } : { kind: 'log', text: 'Starting...' };
    case 'completed':
      return { kind: 'folder', text: `📁 ${job.outputFolder}` };
    case 'failed':
    case 'timed_out': {
      // A bare exit code says less than the downloader's own last words.
      const genericError = !job.error || EXIT_CODE_ERROR_RE.test(job.error);
      const text = genericError ? lastLog || job.error : job.error;
      return text ? { kind: 'error', text } : null;
    }
    default:
      return null;
  }
}

// Shows the options that tell otherwise identical jobs apart.
function downloadTags(job) {
  const tags = [];
  if (job.language) tags.push(job.language);
  if (job.quality && job.quality !== DEFAULT_QUALITY) tags.push(`${job.quality}p`);
  return tags;
}

// Webhooks
async function loadWebhooks() {
  try {
    renderWebhooks(await apiRequest('/webhooks'));
  } catch (error) {
    console.error('Failed to load webhooks:', error);
    const item = document.createElement('li');
    item.className = 'webhook-empty error';
    item.textContent = `Failed to load webhooks: ${error.message}`;
    elements.webhookList.replaceChildren(item);
  }
}

async function addWebhook() {
  const url = elements.webhookInput.value.trim();
  if (!url) return;

  elements.webhookAddBtn.disabled = true;
  try {
    renderWebhooks(await apiRequest('/webhooks', { method: 'POST', body: JSON.stringify({ url }) }));
    elements.webhookInput.value = '';
    showStatus('Webhook added', 'success', 3000);
  } catch (error) {
    if (error.status === 409) {
      elements.webhookInput.value = '';
      showStatus('That webhook is already registered', 'info', 4000);
      return;
    }
    console.error('Add webhook error:', error);
    showStatus(`Failed to add webhook: ${error.message}`, 'error', 8000);
  } finally {
    elements.webhookAddBtn.disabled = false;
  }
}

async function removeWebhook(url) {
  try {
    await apiRequest(`/webhooks/${encodeURIComponent(url)}`, { method: 'DELETE' });
    showStatus('Webhook removed', 'success', 3000);
  } catch (error) {
    console.error('Remove webhook error:', error);
    showStatus(`Failed to remove webhook: ${error.message}`, 'error', 8000);
  }
  loadWebhooks();
}

function renderWebhooks(urls) {
  if (urls.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'webhook-empty';
    empty.textContent = 'No webhooks registered.';
    elements.webhookList.replaceChildren(empty);
    return;
  }

  elements.webhookList.replaceChildren(...urls.map(url => {
    const item = document.createElement('li');
    item.className = 'webhook-item';

    const text = document.createElement('span');
    text.className = 'webhook-url';
    text.textContent = url;
    text.title = url;

    const remove = document.createElement('button');
    remove.className = 'btn btn-secondary btn-small';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove webhook ${url}`);
    remove.addEventListener('click', () => {
      remove.disabled = true;
      removeWebhook(url);
    });

    item.append(text, remove);
    return item;
  }));
}

// Status message helpers
let statusTimer;
function showStatus(message, type = 'info', hideAfterMs) {
  clearTimeout(statusTimer);
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${type}`;
  elements.statusMessage.classList.remove('hidden');
  if (hideAfterMs) statusTimer = setTimeout(hideStatus, hideAfterMs);
}

function hideStatus() {
  elements.statusMessage.classList.add('hidden');
}

function showError(message) {
  elements.errorState.classList.remove('hidden');
  elements.errorMessage.textContent = message;
  elements.results.classList.add('hidden');
  elements.emptyState.classList.add('hidden');
  elements.resultCount.textContent = '';
}

function hideError() {
  elements.errorState.classList.add('hidden');
}

function showLoading() {
  elements.loading.classList.remove('hidden');
  elements.results.classList.add('hidden');
  elements.emptyState.classList.add('hidden');
  elements.resultCount.textContent = '';
}

function hideLoading() {
  elements.loading.classList.add('hidden');
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
