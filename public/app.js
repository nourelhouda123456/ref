// metierRef — app.js (Complete Rewrite)

document.addEventListener('DOMContentLoaded', () => {
  // ─── State ─────────────────────────────────────────────────────────
  window.allMetiers   = [];
  window.allSkills    = [];
  window.comparedJobs = JSON.parse(localStorage.getItem('rtmc_compared') || '[]');
  window.currentLang  = 'fr';

  let selectedDomain    = null;
  let activeSearchQuery = '';
  let activeSkillFilter = null;
  let visibleCount      = 12;
  let activeSourceFilter = 'all'; // 'all', 'rtmc', 'esco'
  let activeViewMode     = 'grid'; // 'grid', 'constellation'

  // ─── Helpers ───────────────────────────────────────────────────────
  const $  = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const esc = (v = '') => String(v).replace(/[&<>'"\u202f]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":"&#39;",'"':'&quot;','\u202f':' '}[c]));

  // ─── Relevance Scoring for Search & Autocomplete ─────────────────
  const getRelevanceScore = (metier, query) => {
    if (!query) return 0;
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!q) return 0;

    const t = (metier.titre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const c = (metier.code || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // 1. Title exact match or title starts with query
    if (t === q) return 1000;
    if (t.startsWith(q)) return 900;

    // 2. Any word in title starts with query
    const words = t.split(/[\s\-_'\/]+/);
    if (words.some(w => w.startsWith(q))) return 800;

    // 3. Appellations start with query
    const apps = (metier.appellations || []).map(a => (a || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    if (apps.some(a => a.startsWith(q))) return 700;

    // 4. Code starts with query
    if (c.startsWith(q)) return 600;

    // 5. Any word in appellations starts with query
    if (apps.some(a => a.split(/[\s\-_'\/]+/).some(w => w.startsWith(q)))) return 500;

    // 6. Title contains query anywhere
    if (t.includes(q)) return 400;

    // 7. Appellations contain query anywhere
    if (apps.some(a => a.includes(q))) return 300;

    // 8. Definition contains query
    const def = (metier.definition || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (def.includes(q)) return 200;

    return 0;
  };

  // ─── Domain Emojis ─────────────────────────────────────────────────
  const EMOJIS = {
    'Agriculture et pêche': '🌾',
    "Artisanat et façonnage d'ouvrages d'art": '🏺',
    'Banque et assurance': '🏦',
    'Commerce, vente et grande distribution': '🛒',
    'Communication, média et multimédia': '📣',
    'Construction, bâtiment et travaux publiques': '🏗️',
    'Hôtellerie, restauration et tourisme': '🏨',
    'Industrie': '🏭',
    'Installation et maintenance': '🔧',
    'Santé': '🏥',
    'Service à la personne et à la société': '👥',
    'Arts et Spectacle': '🎨',
    "Support à l'entreprise": '📁',
    'Transport et logistique': '🚚',
    'Technologies de l\u2019Information et de la Communication-TIC': '💻'
  };

  // ─── i18n ──────────────────────────────────────────────────────────
  const T = {
    fr: {
      nav_home:'Accueil', nav_skills:'Compétences', nav_salary:'Niveaux & Salaires IA', nav_mobility:'Mobilité & Reconversion', nav_about:'À propos',
      btn_explore:'Explorer les métiers', btn_search:'Rechercher',
      btn_discover_skills:'Découvrir les compétences', btn_clear:'✕ Effacer les filtres',
      hero_title:'Découvrez le métier qui vous correspond',
      hero_subtitle:'Explorez les métiers, les compétences et les secteurs du Référentiel Tunisien.',
      search_placeholder:'Rechercher un métier, une compétence…',
      sectors_title:'Explorez par grand domaine', sectors_subtitle:'Cliquez sur un secteur pour filtrer les métiers.',
      jobs_title:'Découvrez les métiers', jobs_subtitle:'Fiches officielles du Référentiel Tunisien des Métiers et des Compétences.',
      jobs_count_suffix:' métiers disponibles',
      card_skills_count:'compétences', card_salary_est:'TND / mois', card_salary_note:'*Basé sur données INS 2022',
      skills_title:'Les compétences au cœur de l\'orientation',
      skills_subtitle:'Cliquez sur une compétence pour filtrer les métiers associés.',
      demo_title:'Comprendre une fiche métier RTMC',
      demo_subtitle:'Structure des informations du Référentiel Tunisien des Métiers et des Compétences.',
      cta_footer_title:'Votre prochaine opportunité commence par une découverte',
      cta_footer_text:'Explorez les métiers et découvrez les compétences qui façonnent le monde professionnel.',
      footer_desc:'Plateforme indépendante d\'exploration basée sur le RTMC.',
      footer_sources:'Sources', footer_legal:'Données ANETI / RTMC Tunisie.',
      toast_added:'Métier ajouté au comparateur.', toast_removed:'Métier retiré.',
      toast_max:'Maximum 3 métiers dans le comparateur.',
      btn_compare_label:'Comparer', btn_compare_remove:'Retirer',
      compare_modal_title:'Comparateur de Métiers',
      compare_empty_title:'Comparateur vide', compare_empty_text:'Sélectionnez des métiers à comparer.',
      tab_details:'Fiche Métier', tab_skills:'Compétences', tab_path:'Parcours d\'accès', tab_similar:'Métiers Similaires',
      load_more:'Charger plus de métiers', results_found:'métier(s) trouvé(s)',
      btn_details:'Plus de détails →'
    },
    en: {
      nav_home:'Home', nav_skills:'Skills', nav_salary:'Levels & Salaries AI', nav_mobility:'Mobility & Career Shift', nav_about:'About',
      btn_explore:'Explore Careers', btn_search:'Search',
      btn_discover_skills:'Discover Skills', btn_clear:'✕ Clear filters',
      hero_title:'Discover the career that matches you',
      hero_subtitle:'Explore careers, skills, and sectors from the Tunisian Reference (RTMC).',
      search_placeholder:'Search for a career or skill…',
      sectors_title:'Explore by Sector', sectors_subtitle:'Click a sector to filter careers.',
      jobs_title:'Discover Careers', jobs_subtitle:'Official reference sheets from the Tunisian careers framework.',
      jobs_count_suffix:' careers available',
      card_skills_count:'skills', card_salary_est:'TND / month', card_salary_note:'*Based on INS 2022 data',
      skills_title:'Skills at the Heart of Orientation',
      skills_subtitle:'Click on a skill to filter associated careers.',
      demo_title:'Understanding an RTMC Career Sheet',
      demo_subtitle:'How information is structured in the Tunisian framework.',
      cta_footer_title:'Your next opportunity begins with a discovery',
      cta_footer_text:'Explore careers and discover skills that shape the professional world.',
      footer_desc:'Independent exploration platform based on the RTMC.',
      footer_sources:'Sources', footer_legal:'Official ANETI / RTMC Tunisia data.',
      toast_added:'Career added to comparison.', toast_removed:'Career removed.',
      toast_max:'Maximum 3 careers in comparator.',
      btn_compare_label:'Compare', btn_compare_remove:'Remove',
      compare_modal_title:'Career Comparator',
      compare_empty_title:'Comparator is empty', compare_empty_text:'Select careers to compare.',
      tab_details:'Career Info', tab_skills:'Skills', tab_path:'Access Path', tab_similar:'Similar Careers',
      load_more:'Load more careers', results_found:'career(s) found',
      btn_details:'More details →'
    }
  };

  // ─── Salary extraction ─────────────────────────────────────────────
  // Utilise les données réelles de l'API si disponibles, sinon fallback heuristique
  function getSalaryRange(metier) {
    // Si le métier a des données salariales de l'API, les utiliser
    if (metier && metier.salary && metier.salary.salaryMin && metier.salary.salaryMax) {
      return {
        min: metier.salary.salaryMin,
        max: metier.salary.salaryMax,
        avg: metier.salary.salaryAvg,
        source: 'api',
        metadata: metier.salary.metadata || null
      };
    }
    
    // Fallback : estimation heuristique basique (ancienne méthode)
    const code = metier?.code || '';
    const p = (code || '').charAt(0).toUpperCase();
    let range;
    if (p === 'I') range = { min: 1600, max: 2800 };
    else if (p === 'A') range = { min: 850,  max: 1350 };
    else if (p === 'B' || p === 'C') range = { min: 1300, max: 2200 };
    else if (p === 'H') range = { min: 1100, max: 1900 };
    else if (p === 'J') range = { min: 1200, max: 2100 };
    else if (p === 'M') range = { min: 1000, max: 1650 };
    else range = { min: 1100, max: 1700 };
    
    return { ...range, avg: Math.round((range.min + range.max) / 2), source: 'heuristic', metadata: null };
  }

  // ─── Compact SVG Radar ─────────────────────────────────────────────
  function compactRadar(item, size = 140, isLarge = false) {
    const cats = [
      { key: 'competencesTechniquesSavoirFaire', label: 'Savoir-faire', color: '#1d4ed8' },
      { key: 'competencesTechniquesSavoir',      label: 'Savoirs',      color: '#7c3aed' },
      { key: 'competencesComportementales',      label: 'Soft Skills',  color: '#059669' },
      { key: 'competencesNumeriques',            label: 'Numérique',    color: '#d97706' },
      { key: 'competencesLangues',               label: 'Langues',      color: '#db2777' },
    ];
    const counts = cats.map(c => (item[c.key] || []).length);
    const maxC   = Math.max(...counts, 1);
    const N      = cats.length;

    // Determine if we're rendering a "big" demo radar (size >= 240)
    const isBig  = size >= 240;
    const cx = size / 2, cy = size / 2;
    const maxR = isBig ? size * 0.30 : isLarge ? size * 0.32 : size * 0.30;

    // Build grid rings
    let rings = '';
    const strokeW = (isLarge || isBig) ? 1.5 : 1;
    [0.33, 0.66, 1].forEach((f, idx) => {
      const pts = cats.map((_, i) => {
        const a = (i / N) * 2 * Math.PI - Math.PI / 2;
        return `${cx + maxR * f * Math.cos(a)},${cy + maxR * f * Math.sin(a)}`;
      }).join(' ');
      const bgFill = idx === 2 ? '#f8fafc' : 'none';
      rings += `<polygon points="${pts}" fill="${bgFill}" stroke="#cbd5e1" stroke-width="${strokeW}"/>`;
    });

    // Build axes
    let axes = '';
    cats.forEach((_, i) => {
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      axes += `<line x1="${cx}" y1="${cy}" x2="${cx + maxR * Math.cos(a)}" y2="${cy + maxR * Math.sin(a)}" stroke="#cbd5e1" stroke-width="${strokeW}" stroke-dasharray="2 2"/>`;
    });

    // Build data polygon
    const pts = counts.map((v, i) => {
      const r = (v / maxC) * maxR;
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(' ');

    // Labels: complete, untruncated category names with count
    let labels = '';
    const labelFontSize = isBig ? 13 : isLarge ? 12 : (size >= 160 ? 10 : 8.5);
    const labelOffset   = isBig ? 28 : isLarge ? 22 : (size >= 160 ? 16 : 13);
    cats.forEach((c, i) => {
      const a  = (i / N) * 2 * Math.PI - Math.PI / 2;
      const r  = maxR + labelOffset;
      const lx = cx + r * Math.cos(a);
      const ly = cy + r * Math.sin(a);
      const anchor = Math.cos(a) > 0.1 ? 'start' : Math.cos(a) < -0.1 ? 'end' : 'middle';
      
      let dy = '';
      if (anchor === 'middle') {
        dy = a < 0 ? 'dy="-4"' : 'dy="9"';
      } else {
        dy = 'dy="3"';
      }

      const count = counts[i];
      const txt = count > 0 ? `${c.label} (${count})` : c.label;
      labels += `<text x="${lx}" y="${ly}" ${dy} text-anchor="${anchor}" font-size="${labelFontSize}" font-weight="700" fill="${c.color}">${esc(txt)}</text>`;
    });

    // Dot points on polygon
    const dotR = (isLarge || isBig) ? 5 : 3.5;
    const dots = counts.map((v, i) => {
      const r = (v / maxC) * maxR;
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      return `<circle cx="${cx + r * Math.cos(a)}" cy="${cy + r * Math.sin(a)}" r="${dotR}" fill="${cats[i].color}" stroke="#fff" stroke-width="2"/>`;
    }).join('');

    const strokePolyW = (isLarge || isBig) ? 2.5 : 2;
    const className = isLarge ? 'large-radar-svg' : 'compact-radar-svg';
    return `<svg viewBox="0 0 ${size} ${size}" class="${className}" aria-hidden="true" overflow="visible">
      ${rings}${axes}
      <polygon points="${pts}" fill="rgba(37,99,235,0.22)" stroke="#2563eb" stroke-width="${strokePolyW}" stroke-linejoin="round"/>
      ${dots}
      ${labels}
    </svg>`;
  }

  // ─── Full Radar (drawer) ───────────────────────────────────────────
  function fullRadar(item, containerId) {
    const container = $('#' + containerId);
    if (!container) return;
    const size = 380;
    container.innerHTML = compactRadar(item, size, true);
  }

  // ─── Scroll to results ─────────────────────────────────────────────
  function scrollToResults() {
    const el = $('#results-section');
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // ─── Debounce ──────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ═══════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════
  initLang();
  initHeader();
  initSearch();
  initComparator();
  initChat();
  loadData();

  // ─── Language ──────────────────────────────────────────────────────
  function initLang() {
    applyT();
  }

  function applyT() {
    const d = T[window.currentLang];
    $$('[data-i18n]').forEach(el => {
      const k = el.dataset.i18n;
      if (d[k] !== undefined) el.textContent = d[k];
    });
    const inp = $('#hero-search-input');
    if (inp && d.search_placeholder) inp.placeholder = d.search_placeholder;
  }

  // ─── Header scroll effect ──────────────────────────────────────────
  function initHeader() {
    const h = $('.header');
    if (!h) return;
    window.addEventListener('scroll', () => {
      h.classList.toggle('scrolled', window.scrollY > 30);
    });
  }

  // ─── Data loading ──────────────────────────────────────────────────
  async function loadData() {
    showShimmer(true);
    try {
      const res = await fetch('/api/metiers');
      if (!res.ok) throw new Error('API error');
      window.allMetiers = await res.json();

      // Index skills
      const sk = new Set();
      window.allMetiers.forEach(m => {
        [...(m.competencesTechniquesSavoirFaire || []),
         ...(m.competencesTechniquesSavoir || []),
         ...(m.competencesComportementales || []),
         ...(m.competencesNumeriques || [])
        ].forEach(s => { if (s && s.trim().length > 2) sk.add(s.trim()); });
      });
      window.allSkills = Array.from(sk).sort((a, b) => a.localeCompare(b, 'fr'));

      // Count sources
      const rtmcCount = window.allMetiers.filter(m => m.source === 'rtmc' || !m.source).length;
      const escoCount = window.allMetiers.filter(m => m.source === 'esco').length;

      if ($('#count-all')) $('#count-all').textContent = window.allMetiers.length.toLocaleString('fr-FR');
      if ($('#count-rtmc')) $('#count-rtmc').textContent = rtmcCount.toLocaleString('fr-FR');
      if ($('#count-esco')) $('#count-esco').textContent = escoCount.toLocaleString('fr-FR');

      showShimmer(false);
      setupToolbarControls();
      setupMobilityMatrix();
      setupCareerSalarySimulator();
      renderSectorPills();
      renderGrid();
      renderSkills();
      renderDemo();
      updateCompareBar();
    } catch (e) {
      showShimmer(false);
      const g = $('#jobs-grid');
      if (g) g.innerHTML = '<div class="empty-state"><p>⚠ Erreur de chargement des données. Vérifiez que le serveur est démarré.</p></div>';
      console.error(e);
    }
  }

  function showShimmer(on) {
    const g = $('#jobs-grid');
    if (!g) return;
    if (on) {
      g.innerHTML = Array(8).fill('<div class="shimmer-card"></div>').join('');
    }
  }

  // ─── Sector Pills ──────────────────────────────────────────────────
  function renderSectorPills() {
    const wrap = $('#sector-pills');
    if (!wrap) return;
    wrap.innerHTML = '';

    const domains = [...new Set(window.allMetiers.map(m => m.domaineGrand).filter(Boolean))].sort((a,b) => a.localeCompare(b,'fr'));

    domains.forEach(domain => {
      const count = window.allMetiers.filter(m => m.domaineGrand === domain).length;
      const pill  = document.createElement('button');
      pill.className = 'sector-pill';
      pill.innerHTML = `${EMOJIS[domain] || '💼'} ${esc(domain)} <span class="pill-count">${count}</span>`;

      pill.addEventListener('click', () => {
        const isActive = pill.classList.contains('active');
        $$('.sector-pill').forEach(p => p.classList.remove('active'));
        $$('.skill-pill').forEach(p => p.classList.remove('active'));
        selectedDomain    = isActive ? null : domain;
        activeSearchQuery = '';
        activeSkillFilter = null;
        $('#hero-search-input').value = '';
        visibleCount = 12;
        if (!isActive) pill.classList.add('active');
        renderGrid();
        scrollToResults();
      });

      wrap.appendChild(pill);
    });
  }

  // ─── Jobs Grid ─────────────────────────────────────────────────────
  function renderGrid() {
    const grid       = $('#jobs-grid');
    const countEl    = $('#results-count');
    const clearBtn   = $('#btn-clear-filters');
    const loadMoreBtn = $('#btn-load-more');
    if (!grid) return;

    const d = T[window.currentLang];

    // Filter by Source
    let list = window.allMetiers;
    if (activeSourceFilter === 'rtmc') list = list.filter(m => m.source === 'rtmc' || !m.source);
    if (activeSourceFilter === 'esco') list = list.filter(m => m.source === 'esco');

    if (selectedDomain)    list = list.filter(m => m.domaineGrand === selectedDomain);
    if (activeSkillFilter) {
      const target = activeSkillFilter.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
      list = list.filter(m => [
        ...(m.competencesTechniquesSavoirFaire || []),
        ...(m.competencesTechniquesSavoir || []),
        ...(m.competencesComportementales || []),
        ...(m.competencesNumeriques || [])
      ].some(s => s && s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(target)));
    }

    if (activeSearchQuery) {
      list = list.map(m => ({ metier: m, score: getRelevanceScore(m, activeSearchQuery) }))
        .filter(item => item.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.metier.titre || '').length - (b.metier.titre || '').length;
        })
        .map(item => item.metier);
    }

    // Count bar
    if (countEl) countEl.textContent = `${list.length.toLocaleString('fr-FR')} ${d.results_found || d.jobs_count_suffix}`;
    if (clearBtn) clearBtn.style.display = (selectedDomain || activeSearchQuery || activeSkillFilter || activeSourceFilter !== 'all') ? 'inline-flex' : 'none';

    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>Aucun métier ne correspond à vos critères.</p></div>';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    grid.innerHTML = '';
    const slice = list.slice(0, visibleCount);

    slice.forEach((item, idx) => {
      const isEsco = item.source === 'esco' || (item.code && item.code.startsWith('ESCO')) || (item.url && item.url.includes('esco'));
      const badgeText = isEsco ? '🇪🇺 ESCO' : '🇹🇳 RTMC';
      const badgeClass = isEsco ? 'chat-badge-esco' : 'chat-badge-rtmc';

      const sal = getSalaryRange(item);
      const totalSkills = (item.competencesTechniquesSavoirFaire||item.essentialSkills||[]).length
        + (item.competencesTechniquesSavoir||item.optionalSkills||[]).length
        + (item.competencesComportementales||[]).length
        + (item.competencesNumeriques||[]).length;

      const desc = (item.resume || item.definition || '').slice(0, 115);

      const card = document.createElement('div');
      card.className = 'job-card';
      card.style.animationDelay = `${(idx % 12) * 35}ms`;

      card.innerHTML = `
        <div class="job-card-stripe"></div>
        <div class="job-card-body">
          <div class="job-card-meta-top">
            <span class="job-card-code">${esc(item.code)}</span>
            <span class="chat-source-origin ${badgeClass}">${badgeText}</span>
          </div>
          <h3 class="job-card-title">${esc(item.titre)}</h3>
          <p class="job-card-desc">${esc(desc)}${desc.length >= 115 ? '…' : ''}</p>

          <div class="job-card-radar">
            <span class="radar-title">Profil de compétences</span>
            ${compactRadar(item)}
          </div>

          <div class="job-card-chips">
            <span class="chip chip-skills">⚡ ${totalSkills} ${d.card_skills_count}</span>
            <span class="chip chip-salary">${isEsco ? '🌐 Europe' : `💰 ${sal.min}–${sal.max} TND*`}</span>
          </div>

          <div class="job-card-actions">
            <button class="btn-card-detail" data-url="${esc(item.url)}">${d.btn_details}</button>
            <button class="btn-card-compare" data-url="${esc(item.url)}" title="${d.btn_compare_label}">⚖</button>
          </div>
        </div>
      `;

      card.querySelector('.btn-card-detail').addEventListener('click', () => openDrawer(item.url));
      const cb = card.querySelector('.btn-card-compare');
      if (window.comparedJobs.includes(item.url)) cb.classList.add('active');
      cb.addEventListener('click', e => { e.stopPropagation(); toggleCompare(item.url, cb); });

      grid.appendChild(card);
    });

    // Load more
    if (loadMoreBtn) {
      if (list.length > visibleCount) {
        loadMoreBtn.style.display = 'inline-flex';
        loadMoreBtn.textContent   = d.load_more;
        loadMoreBtn.onclick = () => { visibleCount += 12; renderGrid(); };
      } else {
        loadMoreBtn.style.display = 'none';
      }
    }
  }

  // ─── Skills cloud ──────────────────────────────────────────────────
  function renderSkills() {
    const cloud = $('#skills-cloud');
    if (!cloud) return;
    cloud.innerHTML = '';

    // Extract all real skills from dataset with frequency
    const skillCounts = new Map();
    (window.allMetiers || []).forEach(m => {
      const seenInJob = new Set();
      [
        ...(m.competencesTechniquesSavoirFaire || []),
        ...(m.competencesTechniquesSavoir || []),
        ...(m.competencesComportementales || []),
        ...(m.competencesNumeriques || [])
      ].forEach(s => {
        const trimmed = s && s.trim();
        if (trimmed && trimmed.length >= 3 && trimmed.length <= 42) {
          const key = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
          const normKey = key.toLowerCase();
          if (!seenInJob.has(normKey)) {
            seenInJob.add(normKey);
            skillCounts.set(key, (skillCounts.get(key) || 0) + 1);
          }
        }
      });
    });

    // Select top 22 most popular real skills
    const topSkills = Array.from(skillCounts.entries())
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 22);

    topSkills.forEach(([skill, count]) => {
      const btn = document.createElement('button');
      const isActive = activeSkillFilter && activeSkillFilter.toLowerCase() === skill.toLowerCase();
      btn.className = 'skill-pill' + (isActive ? ' active' : '');
      btn.innerHTML = `<span class="sp-icon">⚡</span><span class="sp-text">${esc(skill)}</span><span class="sp-count">${count}</span>`;
      btn.addEventListener('click', () => {
        if (activeSkillFilter && activeSkillFilter.toLowerCase() === skill.toLowerCase()) {
          activeSkillFilter = null;
          $('#hero-search-input').value = '';
        } else {
          activeSkillFilter = skill;
          selectedDomain    = null;
          activeSearchQuery = '';
          $('#hero-search-input').value = skill;
          $$('.sector-pill').forEach(p => p.classList.remove('active'));
        }
        $$('.skill-pill').forEach(p => p.classList.toggle('active', p === btn && activeSkillFilter !== null));
        visibleCount = 12;
        renderGrid();
        scrollToResults();
      });
      cloud.appendChild(btn);
    });
  }

  // ─── Demo section ──────────────────────────────────────────────────
  function renderDemo() {
    const box = $('#demo-sheet-box');
    if (!box || !window.allMetiers.length) return;

    const job = window.allMetiers.find(m => m.code === 'I1401') || window.allMetiers[0];
    if (!job) return;
    const sal = getSalaryRange(job);

    const sfChips = (job.competencesTechniquesSavoirFaire||[]).slice(0,4)
      .map(s => `<span class="skill-chip sf">${esc(s)}</span>`).join('');
    const svChips = (job.competencesTechniquesSavoir||[]).slice(0,3)
      .map(s => `<span class="skill-chip sv">${esc(s)}</span>`).join('');
    const ssChips = (job.competencesComportementales||[]).slice(0,3)
      .map(s => `<span class="skill-chip ss">${esc(s)}</span>`).join('');
    const snChips = (job.competencesNumeriques||[]).slice(0,2)
      .map(s => `<span class="skill-chip sn">${esc(s)}</span>`).join('');

    box.innerHTML = `
      <div class="demo-card">

        <!-- Header: full-width title block -->
        <div class="demo-top-header">
          <div class="demo-top-meta">
            <span class="job-card-code">${esc(job.code)}</span>
            <span class="demo-sector-badge">${esc(job.domaineGrand)}</span>
          </div>
          <h2 class="demo-title">${esc(job.titre)}</h2>
          <p class="demo-desc">${esc((job.definition || job.resume || '').slice(0, 200))}…</p>
        </div>

        <!-- Center section: radar + skills side by side -->
        <div class="demo-center-layout">

          <!-- Left: big radar -->
          <div class="demo-radar-panel">
            <div class="demo-radar-label">📊 Profil de compétences</div>
            <div class="demo-radar-svg-wrap">
              ${compactRadar(job, 320)}
            </div>
          </div>

          <!-- Right: skills grouped -->
          <div class="demo-skills-panel">
            ${sfChips ? `<div class="demo-skill-group">
              <div class="demo-skill-group-title" style="color:#1d4ed8;border-color:#bfdbfe">⚡ Savoir-faire techniques</div>
              <div class="demo-chips-wrap">${sfChips}</div>
            </div>` : ''}
            ${svChips ? `<div class="demo-skill-group">
              <div class="demo-skill-group-title" style="color:#7c3aed;border-color:#c4b5fd">📚 Savoirs</div>
              <div class="demo-chips-wrap">${svChips}</div>
            </div>` : ''}
            ${ssChips ? `<div class="demo-skill-group">
              <div class="demo-skill-group-title" style="color:#065f46;border-color:#6ee7b7">🤝 Soft Skills</div>
              <div class="demo-chips-wrap">${ssChips}</div>
            </div>` : ''}
            ${snChips ? `<div class="demo-skill-group">
              <div class="demo-skill-group-title" style="color:#92400e;border-color:#fcd34d">💻 Numérique</div>
              <div class="demo-chips-wrap">${snChips}</div>
            </div>` : ''}
          </div>

        </div>

        <!-- Footer: salary + button -->
        <div class="demo-footer-bar">
          <div class="drawer-salary-block" style="flex:1;max-width:380px">
            <span class="drawer-salary-icon">💰</span>
            <div>
              <div class="drawer-salary-val">${sal.min} – ${sal.max} TND / mois</div>
              <div class="drawer-salary-note">*Basé sur données INS 2022</div>
            </div>
          </div>
          <button class="btn-primary" id="btn-demo-details">Voir la fiche complète →</button>
        </div>

      </div>
    `;

    $('#btn-demo-details').addEventListener('click', () => openDrawer(job.url));
  }

  // ─── Search autocomplete ───────────────────────────────────────────
  function initSearch() {
    const input = $('#hero-search-input');
    const drop  = $('#search-suggestions');
    const form  = $('#hero-search-form');
    const clearBtn = $('#btn-clear-filters');
    if (!input || !drop || !form) return;

    input.addEventListener('input', debounce(() => {
      const val = input.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      drop.innerHTML = '';
      if (val.length < 2) { drop.classList.remove('open'); return; }

      let jobs = window.allMetiers.map(m => ({ metier: m, score: getRelevanceScore(m, val) }))
        .filter(item => {
          if (item.score <= 0) return false;
          if (activeSourceFilter === 'rtmc') return item.metier.source === 'rtmc' || !item.metier.source;
          if (activeSourceFilter === 'esco') return item.metier.source === 'esco';
          return true;
        });

      jobs.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.metier.titre || '').length - (b.metier.titre || '').length;
      });

      const topJobs = jobs.slice(0, 6).map(item => item.metier);

      const skills = window.allSkills.filter(s =>
        s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(val)
      ).sort((a, b) => {
        const na = a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const nb = b.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const aStart = na.startsWith(val);
        const bStart = nb.startsWith(val);
        if (aStart && !bStart) return -1;
        if (!aStart && bStart) return 1;
        return na.localeCompare(nb);
      }).slice(0, 3);

      if (!topJobs.length && !skills.length) { drop.classList.remove('open'); return; }

      if (topJobs.length) {
        const label = document.createElement('div');
        label.className = 'sugg-label';
        label.textContent = '💼 Métiers';
        drop.appendChild(label);
      }

      topJobs.forEach(m => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `<span class="s-icon">💼</span><div><strong>${esc(m.titre)}</strong><small>${esc(m.domaineGrand)} · ${esc(m.code)}</small></div>`;
        div.addEventListener('click', () => {
          input.value = m.titre;
          drop.classList.remove('open');
          openDrawer(m.url);
        });
        drop.appendChild(div);
      });

      if (skills.length) {
        const label = document.createElement('div');
        label.className = 'sugg-label';
        label.textContent = '⚡ Compétences';
        drop.appendChild(label);
      }

      skills.forEach(s => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `<span class="s-icon">⚡</span><div><strong>${esc(s)}</strong><small>Filtrer par compétence</small></div>`;
        div.addEventListener('click', () => {
          input.value       = s;
          activeSkillFilter = s;
          selectedDomain    = null;
          activeSearchQuery = '';
          drop.classList.remove('open');
          $$('.sector-pill').forEach(p => p.classList.remove('active'));
          visibleCount = 12;
          renderGrid();
          scrollToResults();
        });
        drop.appendChild(div);
      });

      drop.classList.add('open');
    }, 160));

    form.addEventListener('submit', e => {
      e.preventDefault();
      const val = input.value.trim();
      drop.classList.remove('open');
      activeSearchQuery = val;
      selectedDomain    = null;
      activeSkillFilter = null;
      $$('.sector-pill').forEach(p => p.classList.remove('active'));
      $$('.skill-pill').forEach(p => p.classList.remove('active'));
      visibleCount = 12;
      renderGrid();
      scrollToResults();
    });

    document.addEventListener('click', e => {
      if (!drop.contains(e.target) && e.target !== input) drop.classList.remove('open');
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        activeSearchQuery = '';
        selectedDomain    = null;
        activeSkillFilter = null;
        input.value       = '';
        $$('.sector-pill').forEach(p => p.classList.remove('active'));
        $$('.skill-pill').forEach(p => p.classList.remove('active'));
        visibleCount = 12;
        renderGrid();
      });
    }
  }

  // ─── Drawer ────────────────────────────────────────────────────────
  async function openDrawer(url) {
    const overlay = $('#job-drawer');
    const content = $('#drawer-content');
    if (!overlay || !content) return;

    const metier = window.allMetiers.find(m => m.url === url);
    if (!metier) { showToast('Fiche introuvable.', 'error'); return; }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    content.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px;padding:8px 0">
      ${Array(4).fill('<div class="shimmer-card" style="height:60px;border-radius:12px"></div>').join('')}
    </div>`;

    setTimeout(() => {
      const isEsco = metier.source === 'esco' || (metier.uri && metier.uri.includes('esco')) || (metier.code && metier.code.startsWith('ESCO'));
      const d   = T[window.currentLang];
      const totalSkills = (metier.competencesTechniquesSavoirFaire||[]).length
        + (metier.competencesTechniquesSavoir||[]).length
        + (metier.competencesComportementales||[]).length
        + (metier.competencesNumeriques||[]).length;

      // Base salary calculation
      let baseMin = 1000, baseMax = 1800;
      const currency = isEsco ? 'EUR' : 'TND';
      const period = isEsco ? 'an' : 'mois';

      if (!isEsco) {
        if (metier.salary && metier.salary.salaryMin && metier.salary.salaryMax) {
          baseMin = metier.salary.salaryMin; baseMax = metier.salary.salaryMax;
        } else {
          const c0 = (metier.code || '').charAt(0).toUpperCase();
          if (c0 === 'M') { baseMin = 1400; baseMax = 2500; }
          else if (c0 === 'I') { baseMin = 1300; baseMax = 2200; }
          else if (c0 === 'J') { baseMin = 1200; baseMax = 2100; }
          else if (c0 === 'A') { baseMin = 750;  baseMax = 1200; }
          else { baseMin = 950; baseMax = 1650; }
        }
      } else {
        baseMin = 32000; baseMax = 48000;
      }

      const levelsDef = [
        { id: 'debutant', label: '🌱 Débutant', exp: '0-1 an', mult: 0.80, bonus: 'Palier d\'entrée (0-1 an)' },
        { id: 'junior',   label: '⚡ Junior',   exp: '1-3 ans', mult: 1.00, bonus: '+25% vs Débutant' },
        { id: 'confirme', label: '⭐ Confirmé', exp: '3-5 ans', mult: 1.35, bonus: '+35% vs Junior' },
        { id: 'senior',   label: '🚀 Senior',   exp: '5-8 ans', mult: 1.80, bonus: '+80% vs Junior' },
        { id: 'expert',   label: '👑 Expert',   exp: '8+ ans',  mult: 2.40, bonus: '+140% vs Junior' }
      ];

      const initialLvl = levelsDef[1]; // Junior default
      const initialMin = Math.round(baseMin * initialLvl.mult);
      const initialMax = Math.round(baseMax * initialLvl.mult);

      content.innerHTML = `
        <div class="formal-doc-wrapper">

          <!-- 2-Column Split Executive Layout at the Top -->
          <div class="formal-doc-top-layout">
            
            <!-- Left Column: Identity, Description & Salary -->
            <div class="formal-doc-left-col">
              
              <!-- Identity Header Card -->
              <div class="formal-doc-header">
                <div class="formal-doc-meta">
                  <span class="formal-doc-badge">${isEsco ? '🇪🇺 RÉFÉRENTIEL EUROPÉEN ESCO' : '🇹🇳 RÉFÉRENTIEL NATIONAL TUNISIEN (RTMC)'}</span>
                  <span class="formal-doc-code">CODE : <strong>${esc(metier.code)}</strong></span>
                </div>

                <h1 class="formal-doc-title">${esc(metier.titre)}</h1>

                <div class="formal-doc-domain">
                  <span class="domain-icon">📁</span>
                  <span><strong>Domaine Grand :</strong> ${esc(metier.domaineGrand)}</span>
                  ${metier.domaineProfessionnel ? `<span class="sep">›</span><span><strong>Domaine Pro :</strong> ${esc(metier.domaineProfessionnel)}</span>` : ''}
                </div>

                <div class="formal-doc-actions">
                  <a href="${esc(metier.url)}" target="_blank" rel="noreferrer" class="btn-formal-outline">📄 Fiche Officielle ANETI / ESCO ↗</a>
                  <button class="btn-formal-primary btn-drawer-compare" data-url="${esc(metier.url)}">⚖ ${d.btn_compare_label}</button>
                  <button class="btn-formal-outline" onclick="window.print()">🖨️ Imprimer la fiche</button>
                </div>
              </div>

              <!-- Section 01: Description générale & Appellations -->
              <div class="formal-section">
                <div class="formal-section-header">
                  <span class="f-sec-num">01</span>
                  <h3>Description générale &amp; Appellations</h3>
                </div>
                <div class="formal-section-body">
                  <p class="formal-text-lead">${esc(metier.definition || metier.resume || 'Aucune description spécifique fournie dans le référentiel.')}</p>

                  ${metier.appellations && metier.appellations.length ? `
                    <div class="formal-subsection">
                      <h4 class="formal-sub-title">Appellations &amp; Intitulés associés</h4>
                      <div class="formal-tags-list">
                        ${metier.appellations.map(a => `<span class="formal-tag-item">${esc(a)}</span>`).join('')}
                      </div>
                    </div>
                  ` : ''}
                </div>
              </div>

              <!-- Salary Estimates card -->
              <div class="formal-metric-card" style="margin-bottom: 24px;">
                <span class="f-metric-label">Estimation Salariale par Expérience</span>
                <div class="f-metric-val" id="drawer-salary-display">
                  ${initialMin.toLocaleString()} – ${initialMax.toLocaleString()} ${currency} / ${period}
                </div>
                <div class="f-metric-sub" id="drawer-salary-note">
                  Niveau : <strong>Junior</strong> (1-3 ans) · ${initialLvl.bonus}
                </div>
                
                <div class="formal-level-selector" id="drawer-level-nav">
                  ${levelsDef.map(l => `
                    <button type="button" class="f-level-btn ${l.id === 'junior' ? 'active' : ''}" data-level="${l.id}" data-min="${Math.round(baseMin * l.mult)}" data-max="${Math.round(baseMax * l.mult)}" data-bonus="${l.bonus}" data-exp="${l.exp}" data-label="${l.label}">
                      ${l.label}
                    </button>
                  `).join('')}
                </div>
              </div>

            </div>

            <!-- Right Column: Radar Chart (Dès le début, à côté) -->
            <div class="formal-doc-right-col">
              <div class="formal-radar-sticky-card">
                <div class="formal-radar-sticky-header">
                  <span class="f-sec-num">02</span>
                  <h3>Profil Radar des Compétences</h3>
                </div>
                
                <div class="formal-radar-wrapper-inner">
                  <div id="drawer-radar"></div>
                </div>

                <div class="formal-radar-legend-box">
                  <div class="f-metric-label">Synthèse des Compétences</div>
                  <div class="f-metric-val" style="color:#1e40af; font-size:18px; margin-bottom: 8px;">${totalSkills} Compétences Clés</div>
                  <div class="radar-legend-items">
                    <span class="radar-legend-dot sf">Savoir-faire: ${(metier.competencesTechniquesSavoirFaire||[]).length}</span>
                    <span class="radar-legend-dot sv">Savoirs: ${(metier.competencesTechniquesSavoir||[]).length}</span>
                    <span class="radar-legend-dot ss">Soft Skills: ${(metier.competencesComportementales||[]).length}</span>
                    ${metier.competencesNumeriques && metier.competencesNumeriques.length ? `<span class="radar-legend-dot sn">Numérique: ${metier.competencesNumeriques.length}</span>` : ''}
                  </div>
                </div>
              </div>
            </div>

          </div> <!-- End of formal-doc-top-layout -->

          <!-- Section 03: Référentiel des Compétences -->
          <div class="formal-section">
            <div class="formal-section-header">
              <span class="f-sec-num">03</span>
              <h3>Référentiel détaillé des compétences</h3>
            </div>
            <div class="formal-section-body">
              <div class="formal-skills-grid">
                ${metier.competencesTechniquesSavoirFaire && metier.competencesTechniquesSavoirFaire.length ? `
                  <div class="formal-skill-box sf">
                    <h4>⚡ Savoir-faire techniques &amp; opérationnels</h4>
                    <ul class="formal-skill-bullets">
                      ${metier.competencesTechniquesSavoirFaire.map(s => `<li>${esc(s)}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}

                ${metier.competencesTechniquesSavoir && metier.competencesTechniquesSavoir.length ? `
                  <div class="formal-skill-box sv">
                    <h4>📘 Connaissances théoriques &amp; Savoirs</h4>
                    <ul class="formal-skill-bullets">
                      ${metier.competencesTechniquesSavoir.map(s => `<li>${esc(s)}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}

                ${metier.competencesComportementales && metier.competencesComportementales.length ? `
                  <div class="formal-skill-box ss">
                    <h4>🤝 Compétences comportementales (Soft Skills)</h4>
                    <ul class="formal-skill-bullets">
                      ${metier.competencesComportementales.map(s => `<li>${esc(s)}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}

                ${metier.competencesNumeriques && metier.competencesNumeriques.length ? `
                  <div class="formal-skill-box sn">
                    <h4>💻 Compétences numériques</h4>
                    <ul class="formal-skill-bullets">
                      ${metier.competencesNumeriques.map(s => `<li>${esc(s)}</li>`).join('')}
                    </ul>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>

          <!-- Section 04: Environnement & Conditions -->
          <div class="formal-section">
            <div class="formal-section-header">
              <span class="f-sec-num">04</span>
              <h3>Environnement &amp; Conditions d'exercice</h3>
            </div>
            <div class="formal-section-body" style="padding:0;">
              <table class="formal-spec-table">
                <tbody>
                  <tr>
                    <th scope="row">Structures d'exercice</th>
                    <td>${(metier.environnementStructures||[]).join(' • ') || 'Non spécifié dans le référentiel.'}</td>
                  </tr>
                  <tr>
                    <th scope="row">Secteurs d'activité</th>
                    <td>${(metier.environnementSecteurs||[]).join(' • ') || 'Non spécifié dans le référentiel.'}</td>
                  </tr>
                  <tr>
                    <th scope="row">Conditions &amp; Contraintes</th>
                    <td>${(metier.environnementConditions||[]).join(' • ') || 'Non spécifié dans le référentiel.'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Section 05: Accès à l'emploi -->
          <div class="formal-section">
            <div class="formal-section-header">
              <span class="f-sec-num">05</span>
              <h3>Conditions d'accès à l'emploi &amp; Diplômes</h3>
            </div>
            <div class="formal-section-body">
              <div class="formal-callout-box">
                <p style="margin:0;">${esc(metier.accesEmploi || 'L\'accès à cet emploi est soumis aux règles de qualification, de diplôme ou d\'expérience exigées par le référentiel officiel.')}</p>
              </div>
            </div>
          </div>

          <!-- Section 06: Mobilités & Métiers similaires -->
          <div class="formal-section">
            <div class="formal-section-header">
              <span class="f-sec-num">06</span>
              <h3>Mobilités &amp; Métiers similaires</h3>
            </div>
            <div class="formal-section-body">
              <div class="similar-jobs-list" id="similar-list"><p style="color:var(--text-muted);font-size:14px">Chargement des équivalences…</p></div>
            </div>
          </div>

          <!-- Footer -->
          <div class="formal-doc-footer">
            <span>Référentiel Officiel RTMC / ESCO — Document généré par metierRef</span>
            <span>Édition 2026</span>
          </div>

        </div>
      `;

      // Render radar chart
      fullRadar(metier, 'drawer-radar');

      // Seniority level pill switching in formal mode
      const salDisplay = content.querySelector('#drawer-salary-display');
      const salNote    = content.querySelector('#drawer-salary-note');
      content.querySelectorAll('.f-level-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          content.querySelectorAll('.f-level-btn').forEach(p => p.classList.remove('active'));
          btn.classList.add('active');
          const min = Number(btn.dataset.min).toLocaleString();
          const max = Number(btn.dataset.max).toLocaleString();
          if (salDisplay) salDisplay.textContent = `${min} – ${max} ${currency} / ${period}`;
          if (salNote) salNote.innerHTML = `Niveau : <strong>${btn.dataset.label.replace(/^[^\s]+\s*/, '')}</strong> (${btn.dataset.exp}) · ${btn.dataset.bonus}`;
        });
      });

      // Compare button
      const cmpBtn = content.querySelector('.btn-drawer-compare');
      if (cmpBtn) {
        if (window.comparedJobs.includes(metier.url)) cmpBtn.textContent = `⚖ ${T[window.currentLang].btn_compare_remove}`;
        cmpBtn.addEventListener('click', () => toggleCompare(metier.url, cmpBtn));
      }

      // Load similar
      loadSimilar(metier.url);
    }, 120);

    // Close
    $('#drawer-close').onclick = closeDrawer;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDrawer(); });
  }

  function closeDrawer() {
    $('#job-drawer').classList.remove('open');
    document.body.style.overflow = '';
  }

  async function loadSimilar(url) {
    const list = $('#similar-list');
    if (!list) return;
    try {
      const res = await fetch(`/api/metiers/similar?url=${encodeURIComponent(url)}&limit=5`);
      const data = await res.json();
      if (!data || !data.length) { list.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Aucun résultat.</p>'; return; }
      list.innerHTML = data.map(s => `
        <div class="similar-job-item" data-url="${esc(s.url)}">
          <div>
            <div class="sji-title">${esc(s.titre)}</div>
            <div class="sji-domain">${esc(s.code)} · ${esc(s.pertinence)}% similaire</div>
          </div>
          <span class="sji-arrow">→</span>
        </div>
      `).join('');
      list.querySelectorAll('.similar-job-item').forEach(el => {
        el.addEventListener('click', () => openDrawer(el.dataset.url));
      });
    } catch {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Erreur de chargement.</p>';
    }
  }

  // ─── Comparator ────────────────────────────────────────────────────
  function initComparator() {
    const closeModal = $('#btn-close-compare-modal');
    if (closeModal) closeModal.onclick = () => { $('#compare-modal').classList.remove('open'); document.body.style.overflow = ''; };

    const viewBtn = $('#btn-view-compare');
    if (viewBtn) viewBtn.onclick = () => { renderCompare(); $('#compare-modal').classList.add('open'); document.body.style.overflow = 'hidden'; };

    const clearBtn = $('#btn-clear-compare');
    if (clearBtn) clearBtn.onclick = () => {
      window.comparedJobs = [];
      localStorage.setItem('rtmc_compared', '[]');
      updateCompareBar();
      $$('.btn-card-compare').forEach(b => b.classList.remove('active'));
    };
  }

  function toggleCompare(url, btn) {
    const d = T[window.currentLang];
    const has = window.comparedJobs.includes(url);
    if (has) {
      window.comparedJobs = window.comparedJobs.filter(u => u !== url);
      showToast(d.toast_removed);
    } else {
      if (window.comparedJobs.length >= 3) { showToast(d.toast_max, 'warning'); return; }
      window.comparedJobs.push(url);
      showToast(d.toast_added);
    }
    localStorage.setItem('rtmc_compared', JSON.stringify(window.comparedJobs));
    updateCompareBar();
    // Sync all compare buttons for this url
    $$(`.btn-card-compare[data-url="${url}"]`).forEach(b => b.classList.toggle('active', !has));
    if (btn) {
      btn.classList.toggle('active', !has);
      if (btn.classList.contains('btn-drawer-compare')) {
        btn.textContent = !has ? `⚖ ${d.btn_compare_remove}` : `⚖ ${d.btn_compare_label}`;
      }
    }
    if ($('#compare-modal').classList.contains('open')) renderCompare();
  }

  function updateCompareBar() {
    const bar = $('#compare-bar');
    const cnt = $('#compare-bar-count');
    if (!bar) return;
    const n = window.comparedJobs.length;
    bar.style.display = n > 0 ? 'flex' : 'none';
    if (cnt) cnt.textContent = `${n} métier(s) sélectionné(s)`;
  }

  function renderCompare() {
    const c = $('#comparison-content');
    if (!c) return;
    const d = T[window.currentLang];
    const selected = window.comparedJobs.map(url => window.allMetiers.find(m => m.url === url)).filter(Boolean);

    if (!selected.length) {
      c.innerHTML = `
        <div class="compare-empty-state">
          <div class="compare-empty-icon">⚖️</div>
          <h3>${d.compare_empty_title}</h3>
          <p>${d.compare_empty_text}</p>
        </div>`;
      return;
    }

    c.innerHTML = `
      <div class="compare-grid">
        ${selected.map(m => {
          const sal = getSalaryRange(m);
          const totalSkills = (m.competencesTechniquesSavoirFaire||[]).length
            + (m.competencesTechniquesSavoir||[]).length
            + (m.competencesComportementales||[]).length
            + (m.competencesNumeriques||[]).length;

          return `
            <div class="compare-col">
              <div class="compare-col-header">
                <div class="compare-header-top">
                  <span class="drawer-code-badge">${esc(m.code)}</span>
                  <button class="btn-remove-cmp" data-url="${esc(m.url)}" title="Retirer de la comparaison" aria-label="Retirer">✕</button>
                </div>
                <h3 class="compare-job-title">${esc(m.titre)}</h3>
                <div class="compare-domain">
                  <span class="cd-icon">🏢</span>
                  <span>${esc(m.domaineGrand)} ${m.domaineProfessionnel ? '› ' + esc(m.domaineProfessionnel) : ''}</span>
                </div>
              </div>

              <!-- Salary highlight -->
              <div class="compare-salary-badge">
                <span class="cs-icon">💰</span>
                <div>
                  <div class="cs-val">${sal.min} – ${sal.max} TND / mois</div>
                  <div class="cs-note">*Estimation INS 2022 · ${totalSkills} compétences</div>
                </div>
              </div>

              <!-- Mini Radar Chart -->
              <div class="compare-radar-wrap">
                ${compactRadar(m, 180)}
              </div>

              <!-- Details sections -->
              <div class="compare-section">
                <div class="compare-sec-title sec-path">🎓 Accès &amp; Formation</div>
                <div class="compare-sec-box">${esc(m.accesEmploi || 'Non spécifié dans le référentiel.')}</div>
              </div>

              <div class="compare-section">
                <div class="compare-sec-title sec-sf">⚡ Savoir-faire clés (Top 5)</div>
                <div class="compare-skills-list">
                  ${(m.competencesTechniquesSavoirFaire || []).length ?
                    (m.competencesTechniquesSavoirFaire || []).slice(0, 5).map(s => `<span class="skill-chip sf">${esc(s)}</span>`).join('')
                    : '<span class="compare-empty-note">Aucun savoir-faire renseigné</span>'
                  }
                </div>
              </div>

              ${(m.competencesTechniquesSavoir || []).length ? `
              <div class="compare-section">
                <div class="compare-sec-title sec-sv">📘 Connaissances théoriques</div>
                <div class="compare-skills-list">
                  ${(m.competencesTechniquesSavoir || []).slice(0, 3).map(s => `<span class="skill-chip sv">${esc(s)}</span>`).join('')}
                </div>
              </div>` : ''}

              <div class="compare-section">
                <div class="compare-sec-title sec-ss">🤝 Soft Skills</div>
                <div class="compare-skills-list">
                  ${(m.competencesComportementales || []).length ?
                    (m.competencesComportementales || []).slice(0, 4).map(s => `<span class="skill-chip ss">${esc(s)}</span>`).join('')
                    : '<span class="compare-empty-note">Aucune compétence comportementale renseignée</span>'
                  }
                </div>
              </div>

              ${(m.competencesNumeriques || []).length ? `
              <div class="compare-section">
                <div class="compare-sec-title sec-sn">💻 Compétences numériques</div>
                <div class="compare-skills-list">
                  ${(m.competencesNumeriques || []).slice(0, 3).map(s => `<span class="skill-chip sn">${esc(s)}</span>`).join('')}
                </div>
              </div>` : ''}

              <div class="compare-col-footer">
                <button class="btn-primary btn-open-drawer-cmp" data-url="${esc(m.url)}">
                  Voir la fiche complète →
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    c.querySelectorAll('.btn-open-drawer-cmp').forEach(b => b.addEventListener('click', () => {
      $('#compare-modal').classList.remove('open');
      document.body.style.overflow = '';
      openDrawer(b.dataset.url);
    }));
    c.querySelectorAll('.btn-remove-cmp').forEach(b => b.addEventListener('click', () => {
      toggleCompare(b.dataset.url);
    }));
  }

  // ─── Chat Widget ───────────────────────────────────────────────────
  function initChat() {
    const fab = $('#chat-widget-trigger');
    const win = $('#chat-widget-window');
    const closeBtn = $('#chat-widget-close');
    const form = $('#chat-widget-form');
    const input = $('#chat-widget-input');
    if (!fab || !win) return;

    // Simple UI (no CV tab)
    win.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-info">
          <span class="chat-header-icon">🤖</span>
          <div>
            <div class="chat-header-title">Assistant IA RTMC</div>
            <div class="chat-header-sub" id="chat-mode-badge">Mode: Lexical</div>
          </div>
        </div>
        <button id="chat-widget-close" class="chat-close-btn" aria-label="Fermer">✕</button>
      </div>

      <div class="chat-messages" id="chat-widget-messages">
        <div class="chat-msg assistant">
          <div class="chat-bubble">
            👋 Bonjour ! Posez-moi une question sur les métiers, les compétences, les formations…<br><br>
          </div>
        </div>
      </div>

      <form class="chat-input-row" id="chat-widget-form">
        <input type="text" id="chat-widget-input" placeholder="Ex: Quels métiers utilisent Python ?" autocomplete="off">
        <button type="submit" class="chat-send-btn" title="Envoyer">↑</button>
      </form>
    `;

    // Re-query elements after rebuild
    const closeBtn2 = $('#chat-widget-close');
    const qForm = $('#chat-widget-form');
    const qInput = $('#chat-widget-input');
    const modeBadge = $('#chat-mode-badge');

    fab.onclick = () => { win.classList.toggle('open'); if (win.classList.contains('open')) qInput?.focus(); };
    closeBtn2.onclick = () => win.classList.remove('open');

    // Question submit
    qForm.onsubmit = async e => {
      e.preventDefault();
      const q = qInput.value.trim();
      if (!q) return;
      chatAddBubble('user', q);
      qInput.value = '';
      const tid = chatAddTyping();
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q })
        });
        const data = await res.json();
        chatRemove(tid);
        chatAddBubble('assistant', data.answer || 'Désolé, aucune réponse trouvée.');
        if (data.sources && data.sources.length) chatAddSources(data.sources);
        if (modeBadge) modeBadge.textContent = `Mode: ${data.mode === 'semantic' ? '🧠 Sémantique' : '🔤 Lexical'}`;
      } catch {
        chatRemove(tid);
        chatAddBubble('error', '⚠️ Erreur de connexion au serveur.');
      }
    };
  }


  let chatN = 0;
  function chatAddBubble(type, html) {
    const msgs = $('#chat-widget-messages');
    if (!msgs) return;
    const id  = 'cb' + chatN++;
    const div = document.createElement('div');
    div.id    = id;
    div.className = `chat-msg ${type === 'user' ? 'user' : type === 'error' ? 'assistant error' : 'assistant'}`;
    div.innerHTML = `<div class="chat-bubble">${type === 'user' ? esc(html) : html}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return id;
  }

  function chatAddTyping() {
    const msgs = $('#chat-widget-messages');
    if (!msgs) return;
    const id  = 'cb' + chatN++;
    const div = document.createElement('div');
    div.id    = id;
    div.className = 'chat-msg assistant';
    div.innerHTML = `<div class="chat-bubble chat-typing"><span></span><span></span><span></span></div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return id;
  }

  function chatRemove(id) {
    document.getElementById(id)?.remove();
  }

  function chatAddSources(sources) {
    const msgs = $('#chat-widget-messages');
    if (!msgs || !sources.length) return;
    const id  = 'cb' + chatN++;
    const div = document.createElement('div');
    div.id    = id;
    div.className = 'chat-msg assistant';
    const cards = sources.map(s => {
      const isEsco = s.source === 'esco' || (s.code && s.code.startsWith('ESCO')) || (s.url && s.url.includes('esco'));
      const badgeText = isEsco ? '🇪🇺 ESCO' : '🇹🇳 RTMC';
      const badgeClass = isEsco ? 'chat-badge-esco' : 'chat-badge-rtmc';
      return `
      <div class="chat-source-card" data-url="${esc(s.url || '')}">
        <div class="chat-source-header">
          <span class="chat-source-code">${esc(s.code || '')}</span>
          <span class="chat-source-origin ${badgeClass}">${badgeText}</span>
        </div>
        <div class="chat-source-title">${esc(s.titre || '')}</div>
        <div class="chat-source-meta">
          <span class="chat-source-domain">${esc(s.domaine || '')}</span>
          ${s.pertinence != null ? `<span class="chat-source-score">${s.pertinence}%</span>` : ''}
        </div>
      </div>
      `;
    }).join('');
    div.innerHTML = `<div class="chat-sources-wrap">${cards}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    // Click to open drawer
    div.querySelectorAll('.chat-source-card[data-url]').forEach(card => {
      if (card.dataset.url) {
        card.style.cursor = 'pointer';
        card.onclick = () => {
          $('#chat-widget-window')?.classList.remove('open');
          openDrawer(card.dataset.url);
        };
      }
    });
  }

  // ─── Source Filter Tabs Controls ──────────────────────────────────
  function setupToolbarControls() {
    // Source Filter Tabs (All, RTMC, ESCO)
    $$('.source-tab').forEach(tab => {
      tab.onclick = () => {
        $$('.source-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeSourceFilter = tab.dataset.source;
        visibleCount = 12;
        renderGrid();
      };
    });
  }


  // ─── Mobility & Transferability Matrix Logic ────────────────────────
  let selectedSourceJob = null;
  let selectedTargetJob = null;

  function setupMobilityMatrix() {
    const inputSource = $('#mobility-input-source');
    const suggSource  = $('#mobility-sugg-source');
    const inputTarget = $('#mobility-input-target');
    const suggTarget  = $('#mobility-sugg-target');
    const btnAnalyze  = $('#btn-analyze-mobility');

    if (!inputSource || !inputTarget || !btnAnalyze) return;

    function setupAutocomplete(inputEl, suggEl, onSelect) {
      inputEl.oninput = debounce(() => {
        const q = inputEl.value.trim().toLowerCase();
        if (q.length < 2) { suggEl.style.display = 'none'; return; }
        const matches = (window.allMetiers || []).filter(m => 
          (m.titre || '').toLowerCase().includes(q) || (m.code || '').toLowerCase().includes(q)
        ).slice(0, 7);

        if (!matches.length) { suggEl.style.display = 'none'; return; }

        const header = `<div class="mobility-sugg-header">🔍 ${matches.length} résultat${matches.length > 1 ? 's' : ''} trouvé${matches.length > 1 ? 's' : ''}</div>`;
        const items = matches.map(m => {
          const isEsco = m.source === 'esco';
          const badgeClass = isEsco ? 'esco' : 'rtmc';
          const badgeLabel = isEsco ? '🇪🇺 ESCO' : '🇹🇳 RTMC';
          return `
            <div class="mobility-sugg-item" data-url="${esc(m.url)}">
              <div class="mobility-sugg-item-left">
                <span class="mobility-sugg-title">${esc(m.titre)}</span>
                <span class="mobility-sugg-code">Code : ${esc(m.code || '—')} &nbsp;·&nbsp; ${esc(m.domaineGrand || m.domaine || '')}</span>
              </div>
              <span class="mobility-sugg-badge ${badgeClass}">${badgeLabel}</span>
            </div>`;
        }).join('');
        suggEl.innerHTML = header + items;
        suggEl.style.display = 'block';
        suggEl.style.overflowY = 'auto';

        suggEl.querySelectorAll('.mobility-sugg-item').forEach(item => {
          item.onclick = () => {
            const found = window.allMetiers.find(m => m.url === item.dataset.url);
            if (found) {
              inputEl.value = `${found.titre} (${found.code || ''})`;
              onSelect(found);
            }
            suggEl.style.display = 'none';
          };
        });
      }, 150);

      document.addEventListener('click', e => {
        if (!inputEl.contains(e.target) && !suggEl.contains(e.target)) {
          suggEl.style.display = 'none';
        }
      });
    }

    setupAutocomplete(inputSource, suggSource, m => selectedSourceJob = m);
    setupAutocomplete(inputTarget, suggTarget, m => selectedTargetJob = m);

    btnAnalyze.onclick = async () => {
      if (!selectedSourceJob || !selectedTargetJob) {
        showToast('Veuillez sélectionner le Métier Source (A) et le Métier Cible (B)', 'warning');
        return;
      }

      btnAnalyze.disabled = true;
      btnAnalyze.textContent = '⏳ Analyse en cours...';

      try {
        const res = await fetch('/api/transferability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceUrl: selectedSourceJob.url || selectedSourceJob.code,
            targetUrl: selectedTargetJob.url || selectedTargetJob.code
          })
        });

        const data = await res.json();
        btnAnalyze.disabled = false;
        btnAnalyze.innerHTML = '⚡ Analyser';

        if (data.error) throw new Error(data.error);

        // Mark step 3 done
        const step3 = document.getElementById('mobility-step-result');
        if (step3) step3.classList.add('active', 'done');

        renderMobilityResults(data);
      } catch (err) {
        btnAnalyze.disabled = false;
        btnAnalyze.innerHTML = '⚡ Analyser';
        showToast(err.message || 'Erreur lors de l\'analyse', 'warning');
      }
    };

    // Reset button
    const btnReset = document.getElementById('btn-reset-mobility');
    if (btnReset) {
      btnReset.onclick = () => {
        selectedSourceJob = null;
        selectedTargetJob = null;
        if (inputSource) inputSource.value = '';
        if (inputTarget) inputTarget.value = '';
        const out = document.getElementById('mobility-results-output');
        if (out) { out.style.display = 'none'; out.innerHTML = ''; }
        const s3 = document.getElementById('mobility-step-result');
        if (s3) s3.classList.remove('active', 'done');
        showToast('Analyse réinitialisée ✓');
      };
    }
  }

  function renderMobilityResults(data) {
    const output = $('#mobility-results-output');
    if (!output) return;

    const scoreDeg = Math.round((data.matchPercentage / 100) * 360);
    const isSourceEsco = data.sourceJob.source === 'esco';
    const isTargetEsco = data.targetJob.source === 'esco';

    output.innerHTML = `
      <div class="mobility-summary-card">
        <div class="mobility-gauge-box">
          <div class="mobility-score-circle" style="--score-deg: ${scoreDeg}">
            <span class="mobility-score-val">${data.matchPercentage}%</span>
          </div>
          <span class="mobility-gauge-label">Transférabilité</span>
        </div>

        <div class="mobility-info-cols">
          <h3 class="mobility-job-title">
            Passerelle : <span style="color:var(--primary)">${esc(data.sourceJob.titre)}</span> ➔ <span style="color:#059669">${esc(data.targetJob.titre)}</span>
          </h3>
          <div>
            <span class="chat-source-origin ${isSourceEsco ? 'chat-badge-esco' : 'chat-badge-rtmc'}">${isSourceEsco ? '🇪🇺 ESCO' : '🇹🇳 RTMC'}</span>
            ➔
            <span class="chat-source-origin ${isTargetEsco ? 'chat-badge-esco' : 'chat-badge-rtmc'}">${isTargetEsco ? '🇪🇺 ESCO' : '🇹🇳 RTMC'}</span>
          </div>
          <div class="mobility-badge-effort ${data.effortClass}">
            📊 Niveau d'Effort : ${esc(data.effort)}
          </div>
        </div>
      </div>

      <div class="mobility-skills-grid">
        <div class="mobility-skills-col">
          <div class="mobility-skills-head acquired">
            <span>✅ Compétences Déjà Acquises (${data.acquiredSkills.length})</span>
          </div>
          ${data.acquiredSkills.length ? data.acquiredSkills.map(s => `
            <div class="mobility-skill-item acquired">
              <span>✓ ${esc(s)}</span>
            </div>
          `).join('') : '<p style="font-size:13px;color:var(--text-muted)">Aucune compétence directe commune identifiée.</p>'}
        </div>

        <div class="mobility-skills-col">
          <div class="mobility-skills-head missing">
            <span>⚡ Compétences à Acquérir / Écart (${data.missingSkills.length})</span>
          </div>
          ${data.missingSkills.length ? data.missingSkills.map(s => `
            <div class="mobility-skill-item missing">
              <span>+ ${esc(s)}</span>
            </div>
          `).join('') : '<p style="font-size:13px;color:#16a34a">🎉 Profil 100% prêt pour cette reconversion !</p>'}
        </div>
      </div>
    `;

    output.style.display = 'block';
    output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ─── Career Seniority & Salary Simulator Logic ──────────────────────
  let selectedCareerJob = null;
  let selectedCareerLevel = 'junior';

  function setupCareerSalarySimulator() {
    const inputJob    = $('#career-salary-input');
    const suggBox     = $('#career-salary-sugg');
    const levelBtns   = $$('#career-level-selector .career-level-btn');
    const btnSimulate = $('#btn-career-simulate');
    const btnReset    = $('#btn-career-reset');

    if (!inputJob || !btnSimulate) return;

    // Autocomplete for Job search
    inputJob.oninput = debounce(() => {
      const q = inputJob.value.trim().toLowerCase();
      if (q.length < 2) { suggBox.style.display = 'none'; return; }
      const matches = (window.allMetiers || []).filter(m => 
        (m.titre || '').toLowerCase().includes(q) ||
        (m.code || '').toLowerCase().includes(q) ||
        (m.domaineGrand || '').toLowerCase().includes(q)
      ).slice(0, 7);

      if (!matches.length) { suggBox.style.display = 'none'; return; }

      suggBox.innerHTML = `
        <div class="mobility-sugg-header">🔍 ${matches.length} métier${matches.length > 1 ? 's' : ''} trouvé${matches.length > 1 ? 's' : ''}</div>
        ${matches.map(m => {
          const isEsco = m.source === 'esco';
          return `
            <div class="career-sugg-item" data-url="${esc(m.url)}">
              <div class="mobility-sugg-item-left">
                <span class="mobility-sugg-title">${esc(m.titre)}</span>
                <span class="mobility-sugg-code">Code : ${esc(m.code || '—')} &nbsp;·&nbsp; ${esc(m.domaineGrand || '')}</span>
              </div>
              <span class="mobility-sugg-badge ${isEsco ? 'esco' : 'rtmc'}">${isEsco ? '🇪🇺 ESCO' : '🇹🇳 RTMC'}</span>
            </div>`;
        }).join('')}
      `;

      suggBox.style.display = 'block';

      suggBox.querySelectorAll('.career-sugg-item').forEach(item => {
        item.onclick = () => {
          const found = window.allMetiers.find(m => m.url === item.dataset.url);
          if (found) {
            inputJob.value = `${found.titre} (${found.code || ''})`;
            selectedCareerJob = found;
          }
          suggBox.style.display = 'none';
        };
      });
    }, 150);

    document.addEventListener('click', e => {
      if (!inputJob.contains(e.target) && !suggBox.contains(e.target)) {
        suggBox.style.display = 'none';
      }
    });

    // Level buttons selection
    levelBtns.forEach(btn => {
      btn.onclick = () => {
        levelBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedCareerLevel = btn.dataset.level || 'junior';

        // Auto re-simulate if already rendered
        const output = $('#career-results-output');
        if (output && output.style.display === 'block' && selectedCareerJob) {
          triggerCareerSimulation();
        }
      };
    });

    // Simulate action
    async function triggerCareerSimulation() {
      if (!selectedCareerJob) {
        showToast('Veuillez sélectionner un métier dans la liste', 'warning');
        return;
      }

      btnSimulate.disabled = true;
      btnSimulate.innerHTML = '⏳ Calcul IA en cours...';

      try {
        const res = await fetch('/api/career-salary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobUrl: selectedCareerJob.url || selectedCareerJob.code,
            level: selectedCareerLevel
          })
        });

        const data = await res.json();
        btnSimulate.disabled = false;
        btnSimulate.innerHTML = '⚡ Simuler la Carrière & le Salaire';

        if (data.error) throw new Error(data.error);

        renderCareerSalaryResults(data);
      } catch (err) {
        btnSimulate.disabled = false;
        btnSimulate.innerHTML = '⚡ Simuler la Carrière & le Salaire';
        showToast(err.message || 'Erreur lors de la simulation', 'warning');
      }
    }

    btnSimulate.onclick = triggerCareerSimulation;

    // Reset action
    if (btnReset) {
      btnReset.onclick = () => {
        selectedCareerJob = null;
        selectedCareerLevel = 'junior';
        inputJob.value = '';
        levelBtns.forEach(b => b.classList.toggle('active', b.dataset.level === 'junior'));
        const output = $('#career-results-output');
        if (output) { output.style.display = 'none'; output.innerHTML = ''; }
        showToast('Simulateur réinitialisé ✓');
      };
    }
  }

  function renderCareerSalaryResults(data) {
    const output = $('#career-results-output');
    if (!output) return;

    const curLvl = data.selectedLevel;
    const isEsco = data.isEsco;
    const currency = data.currency;
    const period = data.period;

    // Find max avg salary among levels for percentage chart bars
    const maxVal = Math.max(...data.levelList.map(l => l.salaryAvg), 1);

    output.innerHTML = `
      <!-- KPI Top Grid -->
      <div class="career-kpi-grid">
        <div class="career-kpi-card highlight">
          <span class="career-kpi-label">💰 Fourchette Estimée (${curLvl.label})</span>
          <span class="career-kpi-value">${curLvl.salaryMin.toLocaleString()} – ${curLvl.salaryMax.toLocaleString()} ${currency}</span>
          <span class="career-kpi-sub">Moyenne : ~${curLvl.salaryAvg.toLocaleString()} ${currency} / ${period} · ${isEsco ? 'Europe (ESCO)' : 'Tunisie (RTMC)'}</span>
        </div>

        <div class="career-kpi-card">
          <span class="career-kpi-label">🎯 Échelon & Expérience</span>
          <span class="career-kpi-value" style="font-size:22px;color:#1e293b">${curLvl.icon} ${esc(curLvl.label)}</span>
          <span class="career-kpi-sub" style="color:#64748b">Ancienneté requise : <strong>${curLvl.experience}</strong></span>
        </div>

        <div class="career-kpi-card">
          <span class="career-kpi-label">📈 Progression Salariale</span>
          <span class="career-kpi-value" style="font-size:20px;color:#2563eb">${esc(curLvl.growthBonus)}</span>
          <span class="career-kpi-sub" style="color:#64748b">Par rapport au palier d'entrée</span>
        </div>
      </div>

      <!-- Progression Bar Chart (5 levels) -->
      <div class="career-progression-chart-box">
        <div class="career-chart-title">
          <span>📊 Comparatif des 5 Paliers de Séniorité pour <strong>${esc(data.job.titre)}</strong></span>
          <span style="font-size:12px;color:var(--text-muted)">Unité : ${currency} / ${period}</span>
        </div>
        <div class="career-bars-grid">
          ${data.levelList.map(l => {
            const pct = Math.max(15, Math.round((l.salaryAvg / maxVal) * 100));
            const isSelected = l.id === curLvl.id;
            return `
              <div class="career-bar-row ${isSelected ? 'active' : ''}">
                <div class="career-bar-label">
                  <span>${l.icon}</span>
                  <span>${esc(l.label)}</span>
                </div>
                <div class="career-bar-track">
                  <div class="career-bar-fill" style="width: ${pct}%;"></div>
                </div>
                <div class="career-bar-val">
                  ${l.salaryAvg.toLocaleString()} ${currency}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Split Columns: Skills & Responsibilities -->
      <div class="career-split-grid">
        <div class="career-col-card">
          <div class="career-col-title">
            <span>🎯</span> Compétences Clés Attendues (${curLvl.label})
          </div>
          <div class="career-skill-chips">
            ${curLvl.prioritySkills && curLvl.prioritySkills.length ? curLvl.prioritySkills.map(s => `
              <span class="career-chip">✓ ${esc(s)}</span>
            `).join('') : '<p style="font-size:13px;color:var(--text-muted)">Compétences socles du référentiel.</p>'}
          </div>
          <div style="margin-top:auto;padding-top:10px;font-size:12px;color:#2563eb;font-weight:600">
            Objectif échelon suivant : ${esc(curLvl.nextLevelTarget)}
          </div>
        </div>

        <div class="career-col-card">
          <div class="career-col-title">
            <span>💼</span> Rôle & Missions Types (${curLvl.label})
          </div>
          <p style="font-size:13.5px;color:#334155;line-height:1.5">${esc(curLvl.role)}</p>
          <p style="font-size:13px;color:#64748b;line-height:1.5;margin-top:6px"><strong>Responsabilités :</strong> ${esc(curLvl.responsibilities)}</p>
        </div>
      </div>

      <!-- AI Career Advisor Card -->
      <div class="career-ai-advice-box">
        <span class="career-ai-icon">💡</span>
        <div class="career-ai-content">
          <div class="career-ai-title">Conseil Stratégique de l'Agent IA Carrière</div>
          <div class="career-ai-text">
            ${(data.aiTips || []).map(tip => `<p>• ${esc(tip)}</p>`).join('')}
          </div>
          <button type="button" class="btn-career-ask-ai" id="btn-career-ask-chat">
            💬 Demander conseil à l'Agent IA pour négocier ce salaire
          </button>
        </div>
      </div>
    `;

    output.style.display = 'block';
    output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Handle AI chat prompt trigger
    const chatBtn = output.querySelector('#btn-career-ask-chat');
    if (chatBtn) {
      chatBtn.onclick = () => {
        const chatWin = $('#chat-widget-window');
        const chatInp = $('#chat-widget-input');
        if (chatWin) chatWin.classList.add('open');
        if (chatInp) {
          chatInp.value = `Comment puis-je progresser du niveau ${curLvl.label} au niveau supérieur pour le métier ${data.job.titre} et maximiser mon salaire ?`;
          chatInp.focus();
        }
      };
    }
  }

  // ─── Toast ─────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${type==='warning'?'#92400e':'#065f46'};color:#fff;padding:10px 20px;border-radius:9999px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.2);white-space:nowrap;transition:opacity .4s`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2800);
  }

  // ─── Debounce ──────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ─── MENU MOBILE HAMBURGER ──────────────────────────────────────
  function initMobileMenu() {
    const menuBtn = $('#mobile-menu-btn');
    const menuOverlay = $('#mobile-menu-overlay');
    const mobileLinks = $$('.mobile-nav-link');

    if (!menuBtn || !menuOverlay) return;

    // Toggle menu
    menuBtn.onclick = () => {
      menuBtn.classList.toggle('active');
      menuOverlay.classList.toggle('open');
      document.body.style.overflow = menuOverlay.classList.contains('open') ? 'hidden' : '';
    };

    // Fermer le menu quand on clique sur un lien
    mobileLinks.forEach(link => {
      link.onclick = () => {
        menuBtn.classList.remove('active');
        menuOverlay.classList.remove('open');
        document.body.style.overflow = '';
      };
    });

    // Fermer le menu en cliquant sur l'overlay
    menuOverlay.onclick = (e) => {
      if (e.target === menuOverlay) {
        menuBtn.classList.remove('active');
        menuOverlay.classList.remove('open');
        document.body.style.overflow = '';
      }
    };

    // Fermer le menu avec la touche Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuOverlay.classList.contains('open')) {
        menuBtn.classList.remove('active');
        menuOverlay.classList.remove('open');
        document.body.style.overflow = '';
      }
    });
  }

  // ─── Initialisation ────────────────────────────────────────────────
  initMobileMenu();

}); // end DOMContentLoaded

