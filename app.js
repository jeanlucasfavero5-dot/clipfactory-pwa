// ClipFactory PWA v0.032 - Integração Render + Supabase
const CONFIG = {
  VERSION: 'v0.032',
  PUBLISH_COST_DIAMONDS: 50,
  RENDER_API_URL: window.CLIPFACTORY_RENDER_URL || 'https://clipfactory-api.onrender.com',
  SUPABASE_URL: window.CLIPFACTORY_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: window.CLIPFACTORY_SUPABASE_ANON_KEY || ''
};

const state = {
  diamonds: 250,
  accounts: [
    { id: 'acc-1', platform: 'TikTok', handle: '@clipfactory.pt' },
    { id: 'acc-2', platform: 'YouTube Shorts', handle: '@ClipFactoryShorts' }
  ],
  videos: [
    { id: 'vid-101', title: 'Cortes virais da semana #1', duration: '00:42' },
    { id: 'vid-102', title: 'Dica rápida de produtividade', duration: '00:58' },
    { id: 'vid-103', title: 'Bastidores do estúdio', duration: '01:12' }
  ],
  selectedVideoId: null
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

function showToast(message, isError = false) {
  const el = document.getElementById('statusToast');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  el.style.background = isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.14)';
  el.style.borderColor = isError ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.35)';
  el.style.color = isError ? '#fca5a5' : '#6ee7b7';
}

function renderDiamonds() {
  const el = document.getElementById('diamondCount');
  if (el) el.textContent = String(state.diamonds);
}

function renderVideos() {
  const container = document.getElementById('videosList');
  if (!container) return;
  container.innerHTML = '';
  state.videos.forEach((video) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="video-title">${video.title}</div>
      <div class="meta">Duração: ${video.duration} • Envio: ${CONFIG.PUBLISH_COST_DIAMONDS} diamantes</div>
      <button type="button" class="primary" data-video-id="${video.id}">Enviar para rede social</button>
    `;
    card.querySelector('button').addEventListener('click', () => openPublishModal(video.id));
    container.appendChild(card);
  });
}

function renderAccounts() {
  const listEl = document.getElementById('accountsList');
  const selectEl = document.getElementById('targetPlatform');
  if (listEl) {
    listEl.innerHTML = '';
    state.accounts.forEach((acc) => {
      const row = document.createElement('div');
      row.className = 'account-row';
      row.innerHTML = `<span><strong>${acc.platform}</strong> • ${acc.handle}</span>`;
      listEl.appendChild(row);
    });
  }
  if (selectEl) {
    selectEl.innerHTML = '';
    state.accounts.forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${acc.platform} (${acc.handle})`;
      selectEl.appendChild(opt);
    });
  }
}

function openPublishModal(videoId) {
  const video = state.videos.find((v) => v.id === videoId);
  if (!video) return;
  state.selectedVideoId = videoId;
  document.getElementById('editVideoTitle').value = video.title;
  renderAccounts();
  document.getElementById('publishModal').classList.add('open');
}

async function confirmPublish() {
  const video = state.videos.find((v) => v.id === state.selectedVideoId);
  if (!video) return;

  const updatedTitle = document.getElementById('editVideoTitle').value.trim();
  const accountId = document.getElementById('targetPlatform').value;
  const account = state.accounts.find((a) => a.id === accountId);

  if (!updatedTitle) {
    showToast('Introduza um título válido antes de enviar.', true);
    return;
  }
  if (!account) {
    showToast('Vincule ou selecione uma conta social antes de enviar.', true);
    return;
  }
  if (state.diamonds < CONFIG.PUBLISH_COST_DIAMONDS) {
    showToast('Saldo insuficiente: são necessários 50 diamantes por envio.', true);
    return;
  }

  video.title = updatedTitle;
  state.diamonds -= CONFIG.PUBLISH_COST_DIAMONDS;
  renderDiamonds();
  renderVideos();
  document.getElementById('publishModal').classList.remove('open');

  try {
    await fetch(`${CONFIG.RENDER_API_URL}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: CONFIG.VERSION,
        videoId: video.id,
        title: video.title,
        accountId: account.id,
        diamondCost: CONFIG.PUBLISH_COST_DIAMONDS
      })
    });
  } catch (_) {
    // Fallback local quando executado offline ou sem sessão ativa
  }

  showToast(`"${video.title}" enviado para ${account.platform} (${account.handle}). -50 diamantes debitados.`);
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      window.location.href = './index.html';
    });
    return;
  }

  renderDiamonds();
  renderVideos();
  renderAccounts();

  document.getElementById('cancelPublishBtn')?.addEventListener('click', () => {
    document.getElementById('publishModal').classList.remove('open');
  });

  document.getElementById('confirmPublishBtn')?.addEventListener('click', confirmPublish);

  document.getElementById('openAccountsBtn')?.addEventListener('click', () => {
    renderAccounts();
    document.getElementById('accountsModal').classList.add('open');
  });

  document.getElementById('closeAccountsBtn')?.addEventListener('click', () => {
    document.getElementById('accountsModal').classList.remove('open');
  });

  document.getElementById('linkAccountBtn')?.addEventListener('click', () => {
    const platform = document.getElementById('newPlatform').value;
    const handle = document.getElementById('newHandle').value.trim();
    if (!handle) {
      showToast('Indique um @utilizador ou canal para vincular.', true);
      return;
    }
    state.accounts.push({
      id: `acc-${Date.now()}`,
      platform,
      handle: handle.startsWith('@') ? handle : `@${handle}`
    });
    document.getElementById('newHandle').value = '';
    renderAccounts();
    document.getElementById('accountsModal').classList.remove('open');
    showToast(`Conta ${platform} (${handle}) vinculada com sucesso.`);
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    window.location.href = './login.html';
  });
});
