// Onglet Courses : liste générée depuis le planning
(function () {
  var h = App.h;
  var RAYONS = [
    ['fruits_legumes', 'Fruits et légumes'], ['boulangerie', 'Boulangerie'], ['boucherie', 'Boucherie, charcuterie'],
    ['poissonnerie', 'Poissonnerie'], ['cremerie', 'Crèmerie, frais'], ['epicerie_salee', 'Épicerie salée'],
    ['epicerie_sucree', 'Épicerie sucrée'], ['surgeles', 'Surgelés'], ['boissons', 'Boissons'],
    ['hygiene_maison', 'Hygiène, maison'], ['autre', 'Autre']];
  var SEMAINES_MAX = 2;   // cette semaine + les 2 suivantes
  var etat = { decalage: 0, liste: null, articles: [], erreur: '', occupe: false, papier: App.lire('papier', false),
    prix: [], magasins: [], magasin: App.lire('magasin', '') };

  // ---------- Dates ----------
  function lundiCible() {
    var l = App.lundiDe(App.aujourdhui());
    l.setDate(l.getDate() + 7 * etat.decalage);
    return l;
  }
  function plusJours(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function dateTexte(d) { return JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]; }

  // ---------- Quantités lisibles ----------
  function nombre(x) { return x.toLocaleString('fr-FR', { maximumFractionDigits: 1 }); }
  function arrondi(q) { return q >= 100 ? Math.round(q / 10) * 10 : Math.max(1, Math.round(q)); }
  App.quantiteCourses = function (q, unite) {
    if (unite === 'piece') return String(Math.ceil(q - 1e-9));   // on n'achète pas une demi-courgette
    var a = arrondi(q);
    if (unite === 'g') return a >= 1000 ? nombre(a / 1000) + ' kg' : a + ' g';
    if (unite === 'ml') return a >= 1000 ? nombre(a / 1000) + ' L' : a + ' ml';
    return nombre(q);
  };

  // ---------- Calcul de la liste ----------
  // Restes (reste_de) exclus : leurs portions sont déjà comptées dans le repas du soir.
  // Ingrédients facultatifs et ingrédients retirés d'un repas exclus.
  // Placard/frigo : quantité inconnue = "on en a" -> exclu ; quantité connue -> déduite.
  App.calculerCourses = function (repas, recettes, ingredients, stock) {
    var recParId = {}, ingParNom = {}, stockParId = {}, besoins = {};
    recettes.forEach(function (r) { recParId[r.id] = r; });
    ingredients.forEach(function (i) { ingParNom[i.nom] = i; });
    stock.forEach(function (s) { stockParId[s.ingredient_id] = s; });
    repas.forEach(function (p) {
      if (p.reste_de) return;
      var r = recParId[p.recette_id];
      if (!r) return;
      var facteur = p.portions / (r.portions || 1);
      (r.recette_ingredients || []).forEach(function (ri) {
        if (ri.optionnel || !ri.ingredients) return;
        var i = ingParNom[ri.ingredients.nom];
        if (!i || (p.ingredients_retires || []).indexOf(i.id) !== -1) return;
        var b = besoins[i.id] || (besoins[i.id] = { ingredient: i, quantite: 0, plats: [] });
        b.quantite += Number(ri.quantite) * facteur;
        if (b.plats.indexOf(r.titre) === -1) b.plats.push(r.titre);
      });
    });
    var aAcheter = [], aLaMaison = [];
    Object.keys(besoins).forEach(function (id) {
      var b = besoins[id], s = stockParId[id];
      if (s) {
        if (s.quantite == null) { aLaMaison.push(b); return; }
        b.quantite -= Number(s.quantite);
        if (b.quantite <= 1e-9) { aLaMaison.push(b); return; }
      }
      aAcheter.push(b);
    });
    var tri = function (a, b) { return a.ingredient.nom.localeCompare(b.ingredient.nom, 'fr'); };
    return { aAcheter: aAcheter.sort(tri), aLaMaison: aLaMaison.sort(tri) };
  };

  // ---------- Budget estimé ----------
  // Prix relevé dans le magasin choisi (le plus récent) en priorité, sinon prix de référence × écart du magasin.
  // Coût de la quantité nécessaire (pièces arrondies au-dessus), pas du paquet entier : c'est une estimation.
  App.estimerCourses = function (aAcheter, prix, magasins, magasinId) {
    var mag = magasins.find(function (m) { return m.id === magasinId; });
    var coef = mag ? Number(mag.coefficient) : 1;
    var recent = function (a, b) { return String(b.releve_le || '').localeCompare(String(a.releve_le || '')); };
    var couts = {}, total = 0, sansPrix = [];
    aAcheter.forEach(function (b) {
      var id = b.ingredient.id;
      var lignes = prix.filter(function (p) { return p.ingredient_id === id && Number(p.quantite) > 0; });
      var ici = mag ? lignes.filter(function (p) { return p.magasin_id === mag.id; }).sort(recent)[0] : null;
      var ref = lignes.filter(function (p) { return !p.magasin_id; }).sort(recent)[0];
      var p = ici || ref;
      if (!p) { couts[id] = null; sansPrix.push(b.ingredient.nom); return; }
      var q = b.ingredient.unite_base === 'piece' ? Math.ceil(b.quantite - 1e-9) : b.quantite;
      var c = Number(p.prix_eur) * q / Number(p.quantite) * (ici ? 1 : coef);
      couts[id] = c;
      total += c;
    });
    return { couts: couts, total: total, sansPrix: sansPrix, magasin: mag || null };
  };
  App.euros = function (x) {
    if (x > 0 && x < 0.5) return 'moins de 1 €';
    return Math.round(x).toLocaleString('fr-FR') + ' €';
  };

  async function charger(sb) {
    var lundi = lundiCible();
    var debut = etat.decalage === 0 ? App.aujourdhui() : lundi;   // cette semaine : à partir d'aujourd'hui
    var fin = plusJours(lundi, 6);
    var res = await Promise.all([
      App.chargerRecettes(sb),
      sb.from('planning').select('id, jour, recette_id, portions, reste_de, ingredients_retires')
        .gte('jour', App.dateISO(debut)).lte('jour', App.dateISO(fin)),
      sb.from('ingredients').select('id, nom, rayon, unite_base'),
      sb.from('stock').select('ingredient_id, quantite'),
      sb.from('liste_articles').select('id, ingredient_id, libelle_libre, quantite, coche').eq('semaine', App.dateISO(lundi)).order('id'),
      sb.from('prix').select('ingredient_id, magasin_id, prix_eur, quantite, releve_le'),
      sb.from('magasins').select('id, nom, coefficient').order('nom')
    ]);
    for (var k = 1; k < 5; k++) if (res[k].error) throw res[k].error;
    etat.prix = res[5].error ? [] : res[5].data || [];   // sans prix, la liste reste utilisable
    etat.magasins = res[6].error ? [] : res[6].data || [];
    etat.periode = { debut: debut, fin: fin, lundi: App.dateISO(lundi) };
    etat.nbRepas = res[1].data.filter(function (p) { return !p.reste_de; }).length;
    etat.liste = App.calculerCourses(res[1].data, res[0], res[2].data, res[3].data);
    etat.articles = res[4].data || [];
  }

  function articleDe(ingredientId) {
    return etat.articles.find(function (a) { return a.ingredient_id === ingredientId; });
  }

  // ---------- Affichage ----------
  function rendre(c, ctx) {
    var L = etat.liste, P = etat.periode;
    var libres = etat.articles.filter(function (a) { return !a.ingredient_id; });
    var total = L.aAcheter.length + libres.length;
    var coches = L.aAcheter.filter(function (b) { var a = articleDe(b.ingredient.id); return a && a.coche; }).length +
      libres.filter(function (a) { return a.coche; }).length;

    var html =
      '<div class="sem-nav">' +
        '<button type="button" class="sem-fleche" data-sens="-1" aria-label="Semaine précédente"' + (etat.decalage <= 0 ? ' disabled' : '') + '>‹</button>' +
        '<div class="sem-titre"><span>' + (etat.decalage === 0 ? 'Cette semaine' : etat.decalage === 1 ? 'Semaine prochaine' : 'Dans 2 semaines') + '</span>' +
          '<small>Repas du ' + dateTexte(P.debut) + ' au ' + dateTexte(P.fin) + '</small></div>' +
        '<button type="button" class="sem-fleche" data-sens="1" aria-label="Semaine suivante"' + (etat.decalage >= SEMAINES_MAX ? ' disabled' : '') + '>›</button>' +
      '</div>' +
      (etat.erreur ? '<p class="erreur bandeau" role="alert">' + h(etat.erreur) + '</p>' : '');

    if (!etat.nbRepas && !libres.length) {
      html += App.ecranVide('Rien à acheter pour l\'instant',
        'Ajoute des plats dans le Planning pour cette période : la liste se remplira toute seule.');
    } else {
      var E = App.estimerCourses(L.aAcheter, etat.prix, etat.magasins, etat.magasin);
      if (etat.prix.length && L.aAcheter.length > E.sansPrix.length) {
        var reste = L.aAcheter.reduce(function (s, b) { var a = articleDe(b.ingredient.id); return s + (a && a.coche ? 0 : E.couts[b.ingredient.id] || 0); }, 0);
        html += '<div class="budget"><p class="budget-total">Environ ' + App.euros(E.total) + '</p>' +
          (etat.magasins.length
            ? '<label class="budget-magasin">chez <select id="budget-magasin" aria-label="Magasin">' +
                '<option value="">un magasin moyen</option>' + etat.magasins.map(function (m) {
                  return '<option value="' + h(m.id) + '"' + (E.magasin && E.magasin.id === m.id ? ' selected' : '') + '>' + h(m.nom) + '</option>';
                }).join('') + '</select></label>'
            : '<p class="budget-note">aux prix d\'un magasin moyen</p>') +
          '<p class="budget-note">' + (coches && App.euros(reste) !== App.euros(E.total) ? 'Encore ' + App.euros(reste) + ' à prendre. ' : '') +
            (E.sansPrix.length ? E.sansPrix.length + (E.sansPrix.length > 1 ? ' articles sans prix' : ' article sans prix') + ' (' + h(E.sansPrix.join(', ')) + '). ' : '') +
            (libres.length ? 'Divers non compté.' : '') + '</p></div>';
      }
      html += '<div class="courses-entete"><p class="courses-compte">' + total + (total > 1 ? ' articles' : ' article') +
        (coches ? ', ' + coches + ' dans le caddie' : '') + '</p>' +
        '<button type="button" class="bascule-papier" aria-pressed="' + etat.papier + '">Mode papier</button></div>' +
        '<div class="feuille' + (etat.papier ? ' papier' : '') + '">';
      RAYONS.forEach(function (r) {
        var items = L.aAcheter.filter(function (b) { return (b.ingredient.rayon || 'autre') === r[0]; });
        if (!items.length) return;
        var sousTotal = items.reduce(function (s, b) { return s + (E.couts[b.ingredient.id] || 0); }, 0);
        html += '<section class="rayon"><h2>' + r[1] + (sousTotal ? '<span class="rayon-budget">' + App.euros(sousTotal) + '</span>' : '') + '</h2><ul class="courses-liste">' +
          items.map(function (b) {
            var a = articleDe(b.ingredient.id);
            return ligne('ing:' + b.ingredient.id, b.ingredient.nom, App.quantiteCourses(b.quantite, b.ingredient.unite_base),
              b.plats.join(', '), a && a.coche, false);
          }).join('') + '</ul></section>';
      });
      html += '<section class="rayon"><h2>Divers</h2><ul class="courses-liste">' +
        libres.map(function (a) { return ligne('lib:' + a.id, a.libelle_libre, '', '', a.coche, true); }).join('') + '</ul>' +
        '<div class="courses-ajout"><input type="text" id="libre-texte" maxlength="60" placeholder="Autre chose (essuie-tout, café…)" aria-label="Ajouter un article">' +
        '<button type="button" class="bouton" id="libre-ajouter">Ajouter</button></div></section>';
      html += '</div>';   // fin de la feuille
      if (L.aLaMaison.length) {
        html += '<details class="a-la-maison"><summary>Déjà à la maison (' + L.aLaMaison.length + ')</summary><ul>' +
          L.aLaMaison.map(function (b) { return '<li>' + h(b.ingredient.nom) + '</li>'; }).join('') + '</ul></details>';
      }
    }
    c.innerHTML = html;

    c.querySelectorAll('.sem-fleche').forEach(function (b) {
      b.addEventListener('click', function () { etat.decalage += Number(b.dataset.sens); etat.erreur = ''; recharger(c, ctx); });
    });
    c.querySelectorAll('.article').forEach(function (b) {
      b.addEventListener('click', function () { basculer(c, ctx, b.dataset.cle); });
    });
    var sm = c.querySelector('#budget-magasin');
    if (sm) sm.addEventListener('change', function () { etat.magasin = sm.value; App.ecrire('magasin', sm.value); rendre(c, ctx); });
    var bp = c.querySelector('.bascule-papier');
    if (bp) bp.addEventListener('click', function () {
      etat.papier = !etat.papier;
      App.ecrire('papier', etat.papier);
      if (etat.papier) chargerPolice();
      rendre(c, ctx);
      gererEcran();
    });
    c.querySelectorAll('[data-retirer]').forEach(function (b) {
      b.addEventListener('click', function () { retirerLibre(c, ctx, b.dataset.retirer); });
    });
    var ajout = c.querySelector('#libre-ajouter');
    if (ajout) {
      var champ = c.querySelector('#libre-texte');
      ajout.addEventListener('click', function () { ajouterLibre(c, ctx, champ.value); });
      champ.addEventListener('keydown', function (e) { if (e.key === 'Enter') ajouterLibre(c, ctx, champ.value); });
    }
  }

  function ligne(cle, nom, qte, plats, coche, libre) {
    return '<li class="' + (coche ? 'coche' : '') + '">' +
      '<button type="button" class="article" data-cle="' + h(cle) + '" aria-pressed="' + !!coche + '">' +
        '<span class="case-courses" aria-hidden="true"></span>' +
        '<span class="article-nom">' + h(nom) + (plats ? '<small>' + h(plats) + '</small>' : '') + '</span>' +
        (qte ? '<span class="article-qte">' + h(qte) + '</span>' : '') +
      '</button>' +
      (libre ? '<button type="button" class="form-suppr" data-retirer="' + h(cle.slice(4)) + '" aria-label="Retirer ' + h(nom) + '">Retirer</button>' : '') +
    '</li>';
  }

  // ---------- Actions ----------
  async function basculer(c, ctx, cle) {
    if (etat.occupe) return;
    var sb = ctx.sb, r, a;
    var libre = cle.indexOf('lib:') === 0, id = cle.slice(4);
    a = libre ? etat.articles.find(function (x) { return String(x.id) === id; }) : articleDe(id);
    var nouveau = !(a && a.coche);
    var champs = { coche: nouveau, coche_par: nouveau ? ctx.moi.user_id : null, coche_le: nouveau ? new Date().toISOString() : null };
    etat.occupe = true;
    if (a) {
      r = await sb.from('liste_articles').update(champs).eq('id', a.id);
      if (!r.error) a.coche = nouveau;
    } else {
      r = await sb.from('liste_articles').insert(Object.assign({ semaine: etat.periode.lundi, ingredient_id: id }, champs))
        .select('id, ingredient_id, libelle_libre, quantite, coche').single();
      if (!r.error) etat.articles.push(r.data);
      else if (/duplicate key/.test(r.error.message || '')) {   // l'autre téléphone l'a créé entre-temps
        etat.occupe = false;
        return recharger(c, ctx);
      }
    }
    etat.occupe = false;
    etat.erreur = r.error ? App.traduireErreur(r.error) : '';
    if (c.isConnected) rendre(c, ctx);
  }

  async function ajouterLibre(c, ctx, texte) {
    texte = (texte || '').trim();
    if (!texte || etat.occupe) return;
    etat.occupe = true;
    var r = await ctx.sb.from('liste_articles').insert({ semaine: etat.periode.lundi, libelle_libre: texte })
      .select('id, ingredient_id, libelle_libre, quantite, coche').single();
    etat.occupe = false;
    if (!r.error) etat.articles.push(r.data);
    etat.erreur = r.error ? App.traduireErreur(r.error) : '';
    if (c.isConnected) { rendre(c, ctx); var ch = c.querySelector('#libre-texte'); if (ch && !r.error) ch.focus(); }
  }

  async function retirerLibre(c, ctx, id) {
    if (etat.occupe) return;
    etat.occupe = true;
    var r = await ctx.sb.from('liste_articles').delete().eq('id', id);
    etat.occupe = false;
    if (!r.error) etat.articles = etat.articles.filter(function (a) { return String(a.id) !== String(id); });
    etat.erreur = r.error ? App.traduireErreur(r.error) : '';
    if (c.isConnected) rendre(c, ctx);
  }

  // ---------- Mode papier ----------
  function chargerPolice() {   // écriture manuscrite, chargée seulement si le mode papier sert
    if (document.getElementById('police-papier')) return;
    var l = document.createElement('link');
    l.id = 'police-papier'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&display=swap';
    document.head.appendChild(l);
  }
  if (etat.papier) chargerPolice();

  // En mode papier, l'écran reste allumé tant que la liste est affichée (pratique en magasin)
  var verrou = null;
  async function gererEcran() {
    var actif = etat.papier && afficheeMaintenant() && document.visibilityState === 'visible';
    try {
      if (actif && !verrou && navigator.wakeLock) {
        verrou = await navigator.wakeLock.request('screen');
        verrou.addEventListener('release', function () { verrou = null; });
      } else if (!actif && verrou) {
        var v = verrou; verrou = null; await v.release();
      }
    } catch (e) { verrou = null; }
  }
  setInterval(gererEcran, 5000);

  // ---------- Synchro en direct entre les téléphones ----------
  var canal = null, conteneur = null, contexte = null, minuteur = null;
  function afficheeMaintenant() {   // la zone de contenu est partagée : vérifier que c'est bien l'onglet Courses
    return !!(conteneur && conteneur.isConnected && document.querySelector('.onglet[data-onglet="courses"][aria-current="page"]'));
  }
  function ecouter(ctx, c) {
    conteneur = c; contexte = ctx;
    if (canal || !ctx.sb.channel) return;
    canal = ctx.sb.channel('liste-courses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'liste_articles' }, planifierActualisation)
      .subscribe();
  }
  function planifierActualisation() {
    clearTimeout(minuteur);
    minuteur = setTimeout(actualiserArticles, 300);   // regroupe les changements rapprochés
  }
  async function actualiserArticles() {
    if (!afficheeMaintenant() || !etat.periode) return;
    if (etat.occupe) return planifierActualisation();
    var r = await contexte.sb.from('liste_articles').select('id, ingredient_id, libelle_libre, quantite, coche')
      .eq('semaine', etat.periode.lundi).order('id');
    if (r.error || !afficheeMaintenant()) return;
    etat.articles = r.data || [];
    var champ = conteneur.querySelector('#libre-texte');
    var saisie = champ ? champ.value : '', focus = champ && document.activeElement === champ;
    rendre(conteneur, contexte);
    var nouveau = conteneur.querySelector('#libre-texte');   // ne pas effacer ce qu'on est en train de taper
    if (nouveau) { nouveau.value = saisie; if (focus) nouveau.focus(); }
  }
  // Au retour sur l'appli (téléphone en veille, autre appli) : on se remet à jour
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') planifierActualisation();
    gererEcran();
  });

  async function recharger(c, ctx) {
    c.innerHTML = '<p class="chargement">Préparation de la liste…</p>';
    try { await charger(ctx.sb); }
    catch (err) {
      c.innerHTML = '<p class="erreur">' + h(App.traduireErreur(err)) + '</p>' +
        '<button type="button" class="bouton secondaire" id="courses-reessayer">Réessayer</button>';
      c.querySelector('#courses-reessayer').addEventListener('click', function () { recharger(c, ctx); });
      return;
    }
    if (c.isConnected) rendre(c, ctx);
  }

  App.onglets.push({
    id: 'courses',
    titre: 'Courses',
    icone: '<path d="M3 4h2l2.5 11h10L20 8H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
    rendre: function (c, ctx) {
      etat.erreur = '';
      ecouter(ctx, c);
      return recharger(c, ctx).then(gererEcran);
    }
  });
})();
