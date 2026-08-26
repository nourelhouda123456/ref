// metierRef — app.js (Complete Rewrite)

document.addEventListener('DOMContentLoaded', () => {
  // ─── State ─────────────────────────────────────────────────────────
  window.allMetiers   = [];
  window.allSkills    = [];
  window.comparedJobs = JSON.parse(localStorage.getItem('rtmc_compared') || '[]');
  window.currentLang  = localStorage.getItem('rtmc_lang') || 'fr';

  let selectedDomain    = null;
  let activeSearchQuery = '';
  let activeSkillFilter = null;
  let visibleCount      = 12;

  // ─── Helpers ───────────────────────────────────────────────────────
  const $  = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const esc = (v = '') => String(v).replace(/[&<>'"\u202f]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":"&#39;",'"':'&quot;','\u202f':' '}[c]));

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
      nav_home:'Accueil', nav_skills:'Compétences', nav_about:'À propos',
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
      nav_home:'Home', nav_skills:'Skills', nav_about:'About',
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
  function compactRadar(item, size = 140) {
    const cats = [
      { key: 'competencesTechniquesSavoirFaire', label: 'Savoir-faire', color: '#1a4fba' },
      { key: 'competencesTechniquesSavoir',      label: 'Savoirs',      color: '#7c3aed' },
      { key: 'competencesComportementales',      label: 'Soft Skills',  color: '#059669' },
      { key: 'competencesNumeriques',            label: 'Numérique',    color: '#d97706' },
      { key: 'competencesLangues',               label: 'Langues',      color: '#db2777' },
    ];
    const counts = cats.map(c => (item[c.key] || []).length);
    const maxC   = Math.max(...counts, 1);
    const N      = cats.length;
    const cx = size / 2, cy = size / 2;
    const maxR = size * 0.36;

    // Build grid rings
    let rings = '';
    [0.33, 0.66, 1].forEach(f => {
      const pts = cats.map((_, i) => {
        const a = (i / N) * 2 * Math.PI - Math.PI / 2;
        return `${cx + maxR * f * Math.cos(a)},${cy + maxR * f * Math.sin(a)}`;
      }).join(' ');
      rings += `<polygon points="${pts}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
    });

    // Build axes
    let axes = '';
    cats.forEach((_, i) => {
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      axes += `<line x1="${cx}" y1="${cy}" x2="${cx + maxR * Math.cos(a)}" y2="${cy + maxR * Math.sin(a)}" stroke="#e2e8f0" stroke-width="1"/>`;
    });

    // Build data polygon
    const pts = counts.map((v, i) => {
      const r = (v / maxC) * maxR;
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(' ');

    // Labels
    let labels = '';
    cats.forEach((c, i) => {
      const a  = (i / N) * 2 * Math.PI - Math.PI / 2;
      const r  = maxR + 14;
      const lx = cx + r * Math.cos(a);
      const ly = cy + r * Math.sin(a);
      const anchor = Math.cos(a) > 0.1 ? 'start' : Math.cos(a) < -0.1 ? 'end' : 'middle';
      // First real skill as label, else category name
      const skill = (item[c.key] || [])[0];
      const txt   = skill ? skill.slice(0, 18) + (skill.length > 18 ? '…' : '') : c.label;
      labels += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-size="7.5" fill="#64748b">${esc(txt)}</text>`;
    });

    // Dot points on polygon
    const dots = counts.map((v, i) => {
      const r = (v / maxC) * maxR;
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      return `<circle cx="${cx + r * Math.cos(a)}" cy="${cy + r * Math.sin(a)}" r="3" fill="#1a4fba" stroke="#fff" stroke-width="1.5"/>`;
    }).join('');

    return `<svg viewBox="0 0 ${size} ${size}" class="compact-radar-svg" aria-hidden="true" overflow="visible">
      ${rings}${axes}
      <polygon points="${pts}" fill="rgba(26,79,186,0.18)" stroke="#1a4fba" stroke-width="1.5" stroke-linejoin="round"/>
      ${dots}
      ${labels}
    </svg>`;
  }

  // ─── Full Radar (drawer) ───────────────────────────────────────────
  function fullRadar(item, containerId) {
    const container = $('#' + containerId);
    if (!container) return;
    const size = 200;
    container.innerHTML = compactRadar(item, size).replace('class="compact-radar-svg"', 'class="large-radar-svg"');
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
    const sel = $('#lang-select-header');
    if (!sel) return;
    sel.value = window.currentLang;
    sel.addEventListener('change', e => {
      window.currentLang = e.target.value;
      localStorage.setItem('rtmc_lang', window.currentLang);
      applyT();
      renderGrid();
    });
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

      showShimmer(false);
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

    // Filter
    let list = window.allMetiers;
    if (selectedDomain)    list = list.filter(m => m.domaineGrand === selectedDomain);
    if (activeSkillFilter) list = list.filter(m => [
      ...(m.competencesTechniquesSavoirFaire || []),
      ...(m.competencesTechniquesSavoir || []),
      ...(m.competencesComportementales || []),
      ...(m.competencesNumeriques || [])
    ].map(s => s.toLowerCase()).includes(activeSkillFilter.toLowerCase()));

    if (activeSearchQuery) {
      const q = activeSearchQuery.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      list = list.filter(m => {
        const check = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(q);
        return check(m.titre) || check(m.code) || check(m.definition) || (m.appellations||[]).some(check);
      });
    }

    // Count bar
    if (countEl) countEl.textContent = `${list.length} ${d.results_found || d.jobs_count_suffix}`;
    if (clearBtn) clearBtn.style.display = (selectedDomain || activeSearchQuery || activeSkillFilter) ? 'inline-flex' : 'none';

    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>Aucun métier ne correspond à vos critères.</p></div>';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    grid.innerHTML = '';
    const slice = list.slice(0, visibleCount);

    slice.forEach((item, idx) => {
      const sal = getSalaryRange(item);
      const totalSkills = (item.competencesTechniquesSavoirFaire||[]).length
        + (item.competencesTechniquesSavoir||[]).length
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
            <span class="job-card-domain">${esc(item.domaineGrand)}</span>
          </div>
          <h3 class="job-card-title">${esc(item.titre)}</h3>
          <p class="job-card-desc">${esc(desc)}${desc.length >= 115 ? '…' : ''}</p>

          <div class="job-card-radar">
            <span class="radar-title">Profil de compétences</span>
            ${compactRadar(item)}
          </div>

          <div class="job-card-chips">
            <span class="chip chip-skills">⚡ ${totalSkills} ${d.card_skills_count}</span>
            <span class="chip chip-salary">💰 ${sal.min}–${sal.max} TND*</span>
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

    const popular = [
      'Développement informatique', 'JavaScript', 'Python', 'SQL',
      'Gestion de projet', 'Techniques de vente', 'Règles de sécurité',
      'Éléments de base en comptabilité', 'Travail d\'équipe', 'Rigueur et précision',
      'Maintenance industrielle', 'Communication', 'Soins infirmiers', 'Soudure',
    ];

    popular.forEach(skill => {
      const btn = document.createElement('button');
      btn.className = 'skill-pill';
      btn.textContent = '⚡ ' + skill;
      btn.addEventListener('click', () => {
        activeSkillFilter = skill;
        selectedDomain    = null;
        activeSearchQuery = '';
        $('#hero-search-input').value = skill;
        $$('.sector-pill').forEach(p => p.classList.remove('active'));
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

    box.innerHTML = `
      <div class="demo-card">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
          <span class="job-card-code">${esc(job.code)}</span>
          <span style="color:var(--text-muted);font-size:13px">${esc(job.domaineGrand)}</span>
        </div>
        <h3 style="font-size:22px;font-weight:800;margin-bottom:12px">${esc(job.titre)}</h3>
        <div style="display:grid;grid-template-columns:1fr auto;gap:24px;align-items:start">
          <div>
            <p style="font-size:14px;color:var(--text-muted);line-height:1.7;margin-bottom:16px">${esc(job.definition || job.resume || '')}</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
              ${(job.competencesTechniquesSavoirFaire||[]).slice(0,5).map(s => `<span class="skill-chip sf">${esc(s)}</span>`).join('')}
              ${(job.competencesComportementales||[]).slice(0,3).map(s => `<span class="skill-chip ss">${esc(s)}</span>`).join('')}
              ${(job.competencesNumeriques||[]).slice(0,2).map(s => `<span class="skill-chip sn">${esc(s)}</span>`).join('')}
            </div>
            <div class="drawer-salary-block">
              <span class="drawer-salary-icon">💰</span>
              <div>
                <div class="drawer-salary-val">${sal.min} – ${sal.max} TND / mois</div>
                <div class="drawer-salary-note">*Basé sur données INS 2022</div>
              </div>
            </div>
          </div>
          <div id="demo-radar-container" style="flex-shrink:0">${compactRadar(job, 170)}</div>
        </div>
        <div style="margin-top:20px">
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

      const jobs   = window.allMetiers.filter(m => {
        const t = (m.titre||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        return t.includes(val) || (m.code||'').toLowerCase().includes(val);
      }).slice(0, 6);

      const skills = window.allSkills.filter(s =>
        s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(val)
      ).slice(0, 3);

      if (!jobs.length && !skills.length) { drop.classList.remove('open'); return; }

      if (jobs.length) {
        const label = document.createElement('div');
        label.className = 'sugg-label';
        label.textContent = '💼 Métiers';
        drop.appendChild(label);
      }

      jobs.forEach(m => {
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
      const sal = getSalaryRange(metier);
      const d   = T[window.currentLang];
      const totalSkills = (metier.competencesTechniquesSavoirFaire||[]).length
        + (metier.competencesTechniquesSavoir||[]).length
        + (metier.competencesComportementales||[]).length
        + (metier.competencesNumeriques||[]).length;

      content.innerHTML = `
        <div class="drawer-job-header">
          <span class="drawer-code-badge">${esc(metier.code)}</span>
          <h2 class="drawer-job-title">${esc(metier.titre)}</h2>
          <p class="drawer-domain-path">${esc(metier.domaineGrand)} ${metier.domaineProfessionnel ? '› ' + esc(metier.domaineProfessionnel) : ''}</p>
          <div class="drawer-salary-block">
            <span class="drawer-salary-icon">💰</span>
            <div>
              <div class="drawer-salary-val">${sal.min} – ${sal.max} TND / mois</div>
              <div class="drawer-salary-note">*Basé sur données INS 2022 · ${totalSkills} compétences</div>
            </div>
          </div>
        </div>

        <div class="drawer-tabs">
          <button class="drawer-tab active" data-tab="dt-info">${d.tab_details}</button>
          <button class="drawer-tab" data-tab="dt-skills">${d.tab_skills}</button>
          <button class="drawer-tab" data-tab="dt-path">${d.tab_path}</button>
          <button class="drawer-tab" data-tab="dt-similar">${d.tab_similar}</button>
        </div>

        <!-- TAB: INFO -->
        <div class="drawer-tab-panel active" id="dt-info">
          <p class="drawer-section-title">Description</p>
          <p class="drawer-definition">${esc(metier.definition || metier.resume || '')}</p>
          ${metier.appellations && metier.appellations.length ? `
            <p class="drawer-section-title">Appellations</p>
            <div class="skills-list">${metier.appellations.map(a => `<span class="skill-chip">${esc(a)}</span>`).join('')}</div>
          ` : ''}
          <p class="drawer-section-title">Environnement de travail</p>
          <p class="drawer-definition"><strong>Structures :</strong> ${(metier.environnementStructures||[]).join(', ') || 'N/A'}</p>
          <p class="drawer-definition" style="margin-top:6px"><strong>Secteurs :</strong> ${(metier.environnementSecteurs||[]).join(', ') || 'N/A'}</p>
          <p class="drawer-definition" style="margin-top:6px"><strong>Conditions :</strong> ${(metier.environnementConditions||[]).join(', ') || 'N/A'}</p>
          <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
            <a href="${esc(metier.url)}" target="_blank" rel="noreferrer" class="btn-ghost">Fiche ANETI ↗</a>
            <button class="btn-primary btn-drawer-compare" data-url="${esc(metier.url)}">⚖ ${d.btn_compare_label}</button>
          </div>
        </div>

        <!-- TAB: SKILLS -->
        <div class="drawer-tab-panel" id="dt-skills">
          <div class="drawer-radar-wrap"><div id="drawer-radar"></div></div>
          ${metier.competencesTechniquesSavoirFaire && metier.competencesTechniquesSavoirFaire.length ? `
            <p class="drawer-section-title">⚡ Savoir-faire techniques</p>
            <div class="skills-list">${metier.competencesTechniquesSavoirFaire.map(s => `<span class="skill-chip sf">${esc(s)}</span>`).join('')}</div>
          ` : ''}
          ${metier.competencesTechniquesSavoir && metier.competencesTechniquesSavoir.length ? `
            <p class="drawer-section-title">📘 Connaissances théoriques</p>
            <div class="skills-list">${metier.competencesTechniquesSavoir.map(s => `<span class="skill-chip sv">${esc(s)}</span>`).join('')}</div>
          ` : ''}
          ${metier.competencesComportementales && metier.competencesComportementales.length ? `
            <p class="drawer-section-title">🤝 Soft Skills</p>
            <div class="skills-list">${metier.competencesComportementales.map(s => `<span class="skill-chip ss">${esc(s)}</span>`).join('')}</div>
          ` : ''}
          ${metier.competencesNumeriques && metier.competencesNumeriques.length ? `
            <p class="drawer-section-title">💻 Compétences numériques</p>
            <div class="skills-list">${metier.competencesNumeriques.map(s => `<span class="skill-chip sn">${esc(s)}</span>`).join('')}</div>
          ` : ''}
        </div>

        <!-- TAB: PATH -->
        <div class="drawer-tab-panel" id="dt-path">
          <p class="drawer-section-title">Voie d'accès</p>
          <p class="drawer-definition">${esc(metier.accesEmploi || 'Non spécifié dans le référentiel.')}</p>
        </div>

        <!-- TAB: SIMILAR -->
        <div class="drawer-tab-panel" id="dt-similar">
          <p class="drawer-section-title">Métiers similaires</p>
          <div class="similar-jobs-list" id="similar-list"><p style="color:var(--text-muted);font-size:14px">Chargement…</p></div>
        </div>
      `;

      // Render full radar in skills tab
      fullRadar(metier, 'drawer-radar');

      // Tab switching
      content.querySelectorAll('.drawer-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          content.querySelectorAll('.drawer-tab, .drawer-tab-panel').forEach(el => el.classList.remove('active'));
          btn.classList.add('active');
          const panel = content.querySelector('#' + btn.dataset.tab);
          if (panel) panel.classList.add('active');
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
      c.innerHTML = `<div class="empty-state"><h3>${d.compare_empty_title}</h3><p>${d.compare_empty_text}</p></div>`;
      return;
    }

    c.innerHTML = `<div class="compare-grid">${selected.map(m => {
      const sal = salaryRange(m.code);
      return `<div class="compare-col">
        <span class="job-card-code" style="margin-bottom:10px;display:inline-block">${esc(m.code)}</span>
        <h3>${esc(m.titre)}</h3>
        <div class="compare-row"><strong>Secteur</strong>${esc(m.domaineGrand)}</div>
        <div class="compare-row"><strong>Salaire estimé</strong>${sal.min}–${sal.max} TND/mois*</div>
        <div class="compare-row"><strong>Accès</strong>${esc(m.accesEmploi || 'N/A')}</div>
        <div class="compare-row"><strong>Savoir-faire (top 5)</strong>
          <ul style="margin-top:6px;padding-left:16px;font-size:13px;color:var(--text-muted)">
            ${(m.competencesTechniquesSavoirFaire||[]).slice(0,5).map(s => `<li>${esc(s)}</li>`).join('')}
          </ul>
        </div>
        <div class="compare-row"><strong>Soft Skills</strong>
          <ul style="margin-top:6px;padding-left:16px;font-size:13px;color:var(--text-muted)">
            ${(m.competencesComportementales||[]).slice(0,4).map(s => `<li>${esc(s)}</li>`).join('')}
          </ul>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="btn-primary btn-open-drawer-cmp" data-url="${esc(m.url)}" style="font-size:12px;padding:8px 14px">Voir fiche →</button>
          <button class="btn-ghost btn-remove-cmp" data-url="${esc(m.url)}" style="font-size:12px">✕</button>
        </div>
      </div>`;
    }).join('')}</div>`;

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
    const fab   = $('#chat-widget-trigger');
    const win   = $('#chat-widget-window');
    const close = $('#chat-widget-close');
    const form  = $('#chat-widget-form');
    const input = $('#chat-widget-input');
    if (!fab || !win) return;

    fab.onclick   = () => win.classList.toggle('open');
    close.onclick = () => win.classList.remove('open');

    form.onsubmit = async e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      addBubble('user', q);
      input.value = '';
      const tid = addBubble('typing', '…');
      try {
        const res  = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question: q }) });
        const data = await res.json();
        document.getElementById(tid)?.remove();
        addBubble('assistant', data.answer || 'Désolé, pas de réponse.');
      } catch {
        document.getElementById(tid)?.remove();
        addBubble('assistant', 'Erreur de connexion.');
      }
    };
  }

  let chatN = 0;
  function addBubble(type, text) {
    const msgs = $('#chat-widget-messages');
    if (!msgs) return;
    const id  = 'cb' + chatN++;
    const div = document.createElement('div');
    div.id    = id;
    div.className = `chat-msg ${type === 'user' ? 'user' : 'assistant'}`;
    div.innerHTML = `<div class="chat-bubble">${type === 'typing' ? '<span style="opacity:.5">…</span>' : esc(text).replace(/\n/g,'<br>')}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return id;
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

}); // end DOMContentLoaded
