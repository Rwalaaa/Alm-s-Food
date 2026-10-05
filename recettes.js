// Onglet Recettes : liste filtrable + fiche détaillée
(function () {
  var h = App.h;
  var ETIQUETTES = ['Rapide', 'Végé', 'Léger', 'Copieux', 'Gamelle', 'Réconfortant', 'Petit budget', 'Soupe'];
  var etat = { recettes: null, filtres: [], pays: '', texte: '', ouverte: null, form: null, catalogue: null, ctx: null, occupe: false,
    ciqual: null, ciqualErreur: '', placard: {} };

  // Calcul des valeurs nutritives d'une portion (ingrédients facultatifs exclus)
  App.nutritionPortion = function (r) {
    var t = { kcal: 0, prot: 0, gluc: 0, lip: 0 };
    (r.recette_ingredients || []).forEach(function (ri) {
      var i = ri.ingredients;
      if (!i || ri.optionnel) return;
      var g = i.unite_base === 'piece' ? ri.quantite * (i.poids_piece_g || 0) : ri.quantite;
      t.kcal += g * (i.kcal_100g || 0) / 100;
      t.prot += g * (i.proteines_100g || 0) / 100;
      t.gluc += g * (i.glucides_100g || 0) / 100;
      t.lip += g * (i.lipides_100g || 0) / 100;
    });
    var p = r.portions || 1;
    return { kcal: Math.round(t.kcal / p), prot: Math.round(t.prot / p), gluc: Math.round(t.gluc / p), lip: Math.round(t.lip / p) };
  };

  // Recherche sans tenir compte des accents ni des majuscules
  function simplifier(s) {
    return String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  App.simplifier = simplifier;

  // ---------- Saisonnalité ----------
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  App.MOIS = MOIS;
  // {9,10,11,12,1} -> « de septembre à janvier » ; {3,4,5,9,10,11} -> « de mars à mai et de septembre à novembre »
  function periodes(mois) {
    var m = mois.map(Number).filter(function (x) { return x >= 1 && x <= 12; });
    if (m.length >= 12) return 'toute l\'année';
    var dans = function (x) { return m.indexOf(((x + 11) % 12) + 1) !== -1; };   // x : 1..12
    var debuts = m.filter(function (x) { return !dans(x - 1 === 0 ? 12 : x - 1); }).sort(function (a, b) { return a - b; });
    return debuts.map(function (d) {
      var f = d;
      while (dans(f === 12 ? 1 : f + 1)) f = f === 12 ? 1 : f + 1;
      return f === d ? 'en ' + MOIS[d - 1] : 'de ' + MOIS[d - 1] + ' à ' + MOIS[f - 1];
    }).join(' et ');
  }
  // Ingrédients (non facultatifs) qui ont une saison : de saison ou hors saison pour ce mois (1..12)
  App.saison = function (r, mois) {
    var en = [], hors = [];
    (r.recette_ingredients || []).forEach(function (ri) {
      var i = ri.ingredients;
      if (!i || ri.optionnel || !i.mois_saison || !i.mois_saison.length) return;
      if (i.mois_saison.map(Number).indexOf(mois) !== -1) en.push(i.nom);
      else hors.push({ nom: i.nom, quand: periodes(i.mois_saison) });
    });
    return { en: en, hors: hors, deSaison: en.length > 0 && hors.length === 0 };
  };
  App.periodesSaison = periodes;
  function moisCourant() { return (App.aujourdhui ? App.aujourdhui() : new Date()).getMonth() + 1; }
  // Petite mention pour les listes (recettes, choix d'un plat)
  App.mentionSaison = function (r, mois) {
    var s = App.saison(r, mois);
    if (s.hors.length) return '<span class="hors-saison">Hors saison</span>';
    if (s.deSaison) return '<span class="saison">De saison</span>';
    return '';
  };

  // ---------- Anti-gaspi : ce qu'il y a déjà à la maison ----------
  // Articles du placard qui ne sont pas « Toujours à la maison » : ce qu'il faut utiliser. Nom -> quantité (ou null).
  App.chargerPlacard = async function (sb) {
    var r = await sb.from('stock').select('quantite, permanent, ingredients(nom)');
    if (r.error) throw r.error;
    var p = {};
    (r.data || []).forEach(function (l) { if (!l.permanent && l.ingredients) p[l.ingredients.nom] = l.quantite; });
    return p;
  };
  App.auPlacard = function (r, placard) {
    var noms = [];
    (r.recette_ingredients || []).forEach(function (ri) {
      if (!ri.optionnel && ri.ingredients && Object.prototype.hasOwnProperty.call(placard || {}, ri.ingredients.nom)) noms.push(ri.ingredients.nom);
    });
    return noms;
  };
  App.mentionPlacard = function (r, placard) {
    var n = App.auPlacard(r, placard).length;
    return n ? '<span class="placard">' + n + ' au placard</span>' : '';
  };

  function dureeTexte(min) {
    if (min < 60) return min + ' min';
    var hh = Math.floor(min / 60), mm = min % 60;
    return hh + ' h' + (mm ? ' ' + String(mm).padStart(2, '0') : '');
  }

  async function charger(sb) {
    var r = await sb.from('recettes')
      .select('id, titre, description, categories, pays, vegetarien, temps_prep_min, temps_cuisson_min, portions, ' +
        'se_mange_froid, source, image_url, photo_perso_url, etapes, recette_ingredients(quantite, libelle_quantite, optionnel, ' +
        'ingredients(nom, rayon, unite_base, poids_piece_g, kcal_100g, proteines_100g, glucides_100g, lipides_100g, mois_saison))')
      .order('titre');
    if (r.error) throw r.error;
    r.data.forEach(function (rec) {
      rec._nutri = App.nutritionPortion(rec);
      rec._cherche = simplifier(rec.titre + ' ' + (rec.pays || '') + ' ' +
        (rec.recette_ingredients || []).map(function (ri) { return ri.ingredients ? ri.ingredients.nom : ''; }).join(' '));
    });
    etat.recettes = r.data;
  }

  // Utilisé par les autres onglets (planning…) : recettes chargées une seule fois
  App.chargerRecettes = async function (sb) {
    if (!etat.recettes) await charger(sb);
    return etat.recettes;
  };

  function filtrer() {
    var t = simplifier(etat.texte.trim());
    var res = etat.recettes.filter(function (r) {
      if (t && r._cherche.indexOf(t) === -1) return false;
      if (etat.pays && r.pays !== etat.pays) return false;
      return etat.filtres.every(function (f) {
        if (f === 'De saison') return App.saison(r, moisCourant()).deSaison;
        if (f === 'Avec le placard') return App.auPlacard(r, etat.placard).length > 0;
        return (r.categories || []).indexOf(f) !== -1;
      });
    });
    if (etat.filtres.indexOf('Avec le placard') === -1) return res;
    // Filtre anti-gaspi : d'abord les plats qui utilisent le plus de choses du placard
    return res.map(function (r, k) { return { r: r, k: k, n: App.auPlacard(r, etat.placard).length }; })
      .sort(function (x, y) { return y.n - x.n || x.k - y.k; }).map(function (x) { return x.r; });
  }

  // ---------- Liste ----------
  function rendreListe(c) {
    var pays = Array.from(new Set(etat.recettes.map(function (r) { return r.pays; }).filter(Boolean))).sort();
    c.innerHTML =
      '<button type="button" class="ajouter rec-ajouter">Ajouter une recette</button>' +
      '<div class="rec-outils">' +
        '<input type="search" class="rec-recherche" placeholder="Plat ou ingrédient" aria-label="Chercher une recette" value="' + h(etat.texte) + '">' +
        '<select class="rec-pays" aria-label="Pays">' +
          '<option value="">Tous les pays</option>' +
          pays.map(function (p) { return '<option' + (p === etat.pays ? ' selected' : '') + '>' + h(p) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="puces" role="group" aria-label="Filtres">' +
        ['De saison', 'Avec le placard'].concat(ETIQUETTES).map(function (e) {
          return '<button type="button" class="puce" aria-pressed="' + (etat.filtres.indexOf(e) !== -1) + '">' + h(e) + '</button>';
        }).join('') +
      '</div>' +
      '<p class="rec-compte" aria-live="polite"></p>' +
      '<ul class="rec-liste"></ul>';

    var liste = c.querySelector('.rec-liste'), compte = c.querySelector('.rec-compte');
    function maj() {
      var res = filtrer();
      compte.textContent = res.length === 0 ? '' : res.length + (res.length > 1 ? ' recettes' : ' recette');
      liste.innerHTML = res.length === 0
        ? '<li class="rec-aucune">Aucune recette ne correspond. Retire un filtre ou change ta recherche.</li>'
        : res.map(function (r) {
          return '<li><button type="button" class="rec-item" data-id="' + h(r.id) + '">' +
            '<span class="rec-titre">' + h(r.titre) + '</span>' +
            '<span class="rec-infos"><span>' + dureeTexte(r.temps_prep_min + r.temps_cuisson_min) + '</span>' +
            '<span>' + r._nutri.kcal + ' kcal</span>' + (r.pays ? '<span>' + h(r.pays) + '</span>' : '') + App.mentionSaison(r, moisCourant()) + App.mentionPlacard(r, etat.placard) +
            (r.source === 'perso' ? '<span class="perso">Ma recette</span>' : '') + '</span>' +
            '</button></li>';
        }).join('');
    }
    c.querySelector('.rec-recherche').addEventListener('input', function (e) { etat.texte = e.target.value; maj(); });
    c.querySelector('.rec-pays').addEventListener('change', function (e) { etat.pays = e.target.value; maj(); });
    c.querySelectorAll('.puce').forEach(function (b) {
      b.addEventListener('click', function () {
        var e = b.textContent, i = etat.filtres.indexOf(e);
        if (i === -1) etat.filtres.push(e); else etat.filtres.splice(i, 1);
        b.setAttribute('aria-pressed', String(i === -1));
        maj();
      });
    });
    c.querySelector('.rec-ajouter').addEventListener('click', function () { ouvrirFormulaire(c); });
    liste.addEventListener('click', function (e) {
      var b = e.target.closest('.rec-item');
      if (!b) return;
      etat.ouverte = b.dataset.id;
      try { history.pushState({ recette: etat.ouverte }, ''); } catch (err) { /* sans historique */ }
      rendreFiche(c);
    });
    maj();
  }

  // ---------- Fiche ----------
  function texteSaison(r) {
    var m = moisCourant(), s = App.saison(r, m);
    if (!s.en.length && !s.hors.length) return '';
    return '<p class="fiche-saison">' +
      (s.en.length ? '<span class="saison">De saison en ' + MOIS[m - 1] + ' :</span> ' + h(s.en.join(', ').toLowerCase()) + '.' : '') +
      (s.en.length && s.hors.length ? '<br>' : '') +
      (s.hors.length ? '<span class="hors-saison">Hors saison :</span> ' + s.hors.map(function (x) {
        return h(x.nom.toLowerCase()) + ' (' + x.quand + ')'; }).join(', ') + '.' : '') + '</p>';
  }

  function rendreFiche(c) {
    var r = etat.recettes.find(function (x) { return x.id === etat.ouverte; });
    if (!r) { etat.ouverte = null; return rendreListe(c); }
    var n = r._nutri;
    var ingr = (r.recette_ingredients || []).slice().sort(function (a, b) { return a.optionnel - b.optionnel; });
    c.innerHTML =
      '<button type="button" class="retour">Toutes les recettes</button>' +
      '<article class="fiche">' +
        '<h2 class="fiche-titre">' + h(r.titre) + '</h2>' +
        (r.description ? '<p class="fiche-desc">' + h(r.description) + '</p>' : '') +
        '<p class="fiche-etiquettes">' + (r.source === 'perso' ? '<span class="perso">Ma recette</span>' : '') +
          (r.categories || []).map(function (e) { return '<span>' + h(e) + '</span>'; }).join('') + '</p>' +
        texteSaison(r) +
        '<dl class="fiche-chiffres">' +
          '<div><dt>Préparation</dt><dd>' + dureeTexte(r.temps_prep_min) + '</dd></div>' +
          '<div><dt>Cuisson</dt><dd>' + dureeTexte(r.temps_cuisson_min) + '</dd></div>' +
          '<div><dt>Portions</dt><dd>' + r.portions + '</dd></div>' +
        '</dl>' +
        (App.ouvrirCuisine ? '<button type="button" class="bouton fiche-cuisiner" id="fiche-cuisiner">Cuisiner pas à pas</button>' : '') +
        '<h3>Par portion</h3>' +
        '<dl class="fiche-nutri">' +
          '<div><dt>Énergie</dt><dd>' + n.kcal + ' kcal</dd></div>' +
          '<div><dt>Protéines</dt><dd>' + n.prot + ' g</dd></div>' +
          '<div><dt>Glucides</dt><dd>' + n.gluc + ' g</dd></div>' +
          '<div><dt>Lipides</dt><dd>' + n.lip + ' g</dd></div>' +
        '</dl>' +
        '<h3>Ingrédients</h3>' +
        '<ul class="fiche-ingr">' + ingr.map(function (ri) {
          return '<li><span class="q">' + h(ri.libelle_quantite || ri.quantite) + '</span> ' + h(ri.ingredients ? ri.ingredients.nom : '?') +
            (ri.optionnel ? ' <span class="discret">(facultatif)</span>' : '') +
            (!ri.optionnel && ri.ingredients && Object.prototype.hasOwnProperty.call(etat.placard, ri.ingredients.nom) ? ' <span class="placard">au placard</span>' : '') + '</li>';
        }).join('') + '</ul>' +
        '<h3>Préparation</h3>' +
        '<ol class="fiche-etapes">' + (r.etapes || []).map(function (e) {
          return '<li>' + h(e.texte) + (e.minuteur_s ? ' <span class="minuteur">' + dureeTexte(Math.round(e.minuteur_s / 60)) + '</span>' : '') + '</li>';
        }).join('') + '</ol>' +
      '</article>' +
      '<div class="fiche-actions">' +
        '<button type="button" class="bouton secondaire" id="fiche-modifier">Modifier</button>' +
        '<button type="button" class="bouton-danger" id="fiche-supprimer">Supprimer</button>' +
      '</div>' +
      '<p class="erreur" id="fiche-erreur" role="alert" hidden></p>';
    c.querySelector('.retour').addEventListener('click', function () {
      if (history.state && history.state.recette) history.back(); else fermerFiche(c);
    });
    c.querySelector('#fiche-modifier').addEventListener('click', function () { ouvrirFormulaire(c, r); });
    c.querySelector('#fiche-supprimer').addEventListener('click', function () { supprimer(c, r); });
    var cuire = c.querySelector('#fiche-cuisiner');
    if (cuire) cuire.addEventListener('click', function () { App.ouvrirCuisine(r); });
    window.scrollTo(0, 0);
  }

  function fermerFiche(c) {
    etat.ouverte = null;
    rendreListe(c);
  }

  // ---------- Ajout d'une recette perso ----------
  var RAYONS = [['fruits_legumes', 'Fruits et légumes'], ['boucherie', 'Boucherie'], ['poissonnerie', 'Poissonnerie'],
    ['cremerie', 'Crèmerie'], ['epicerie_salee', 'Épicerie salée'], ['epicerie_sucree', 'Épicerie sucrée'],
    ['surgeles', 'Surgelés'], ['boulangerie', 'Boulangerie'], ['boissons', 'Boissons'], ['autre', 'Autre']];
  var UNITES = { g: 'g', ml: 'ml', piece: 'pièce(s)' };
  var ETIQUETTES_MANUELLES = ['Réconfortant', 'Petit budget', 'Soupe'];
  var NON_VEGE_NOMS = ['Thon au naturel', 'Cube de bouillon de volaille'];

  function nouveauFormulaire() {
    return { titre: '', description: '', pays: '', prep: '', cuisson: '', portions: 2, froid: false, vegeManuel: null,
      tags: [], ingredients: [], etapes: [{ texte: '', minutes: '' }], editeur: null, modifie: false };
  }

  async function chargerCatalogue(sb) {
    if (etat.catalogue) return etat.catalogue;
    var r = await sb.from('ingredients').select('id, nom, rayon, unite_base, poids_piece_g, kcal_100g').order('nom');
    if (r.error) throw r.error;
    etat.catalogue = r.data || [];
    return etat.catalogue;
  }

  // Table Ciqual (Anses) : chargée une fois, à la création du premier nouvel ingrédient
  async function chargerCiqual(sb) {
    if (etat.ciqual) return etat.ciqual;
    var r = await sb.from('ciqual').select('code, nom, kcal_100g, proteines_100g, glucides_100g, lipides_100g, fibres_100g').order('nom');
    if (r.error) throw r.error;
    etat.ciqual = (r.data || []).map(function (c) { c.cle = simplifier(c.nom); return c; });
    return etat.ciqual;
  }
  function chercherCiqual(texte) {
    var mots = simplifier(texte).split(/[^a-z0-9]+/).filter(function (m) { return m.length > 1; });
    if (!mots.length || !etat.ciqual) return [];
    return etat.ciqual.filter(function (c) {
      return mots.every(function (m) { return c.cle.indexOf(m) !== -1; });
    }).map(function (c) {   // d'abord les noms qui commencent par le premier mot, puis l'aliment cru, puis les plus courts
      return { c: c, score: (c.cle.indexOf(mots[0]) === 0 ? 0 : 2) + (/\bcrue?s?\b/.test(c.cle) ? 0 : 1) };
    }).sort(function (a, b) { return a.score - b.score || a.c.nom.length - b.c.nom.length; })
      .slice(0, 8).map(function (x) { return x.c; });
  }
  function kcalCiqual(c) {   // même calcul que la base quand Ciqual ne donne pas les calories
    if (c.kcal_100g != null) return Number(c.kcal_100g);
    if (c.proteines_100g == null || c.glucides_100g == null || c.lipides_100g == null) return null;
    return Math.round((4 * c.proteines_100g + 4 * c.glucides_100g + 9 * c.lipides_100g + 2 * (c.fibres_100g || 0)) * 10) / 10;
  }
  function nombre(v) { return String(Math.round(Number(v) * 10) / 10).replace('.', ','); }
  function resumeCiqual(c) {
    var k = kcalCiqual(c);
    return (k == null ? '? kcal' : nombre(k) + ' kcal') +
      (c.proteines_100g != null ? ' · prot. ' + nombre(c.proteines_100g) + ' g' : '') +
      (c.glucides_100g != null ? ' · gluc. ' + nombre(c.glucides_100g) + ' g' : '') +
      (c.lipides_100g != null ? ' · lip. ' + nombre(c.lipides_100g) + ' g' : '');
  }
  function blocCiqual(N) {
    if (N.ciqual) {
      return '<div class="ciqual-choisi"><p><span class="discret">Valeurs nutritives (Ciqual)</span>' +
        '<strong>' + h(N.ciqual.nom) + '</strong><span class="discret">Pour 100 g : ' + h(resumeCiqual(N.ciqual)) + '</span></p>' +
        '<button type="button" class="lien" data-ciqual-changer="1">Changer</button></div>';
    }
    var res = etat.ciqual ? chercherCiqual(N.ciqualTexte || '') : [];
    return '<label><span>Valeurs nutritives <span class="discret">(facultatif, table Ciqual)</span></span>' +
        '<input id="ciqual-texte" autocomplete="off" maxlength="60" value="' + h(N.ciqualTexte || '') + '" placeholder="Ex. : courgette crue"></label>' +
      (etat.ciqualErreur ? '<p class="erreur">' + h(etat.ciqualErreur) + '</p>'
        : !etat.ciqual ? '<p class="discret">Chargement de la table Ciqual…</p>'
        : res.length ? '<ul class="suggestions">' + res.map(function (c) {
            var k = kcalCiqual(c);
            return '<li><button type="button" data-ciqual="' + c.code + '">' + h(c.nom) +
              ' <span class="discret">' + (k == null ? '' : nombre(k) + ' kcal') + '</span></button></li>';
          }).join('') + '</ul>'
        : '<p class="discret">' + (N.ciqualTexte && N.ciqualTexte.trim() ? 'Aucun aliment trouvé. ' : '') +
            'Sans valeurs, la recette n\'aura pas d\'étiquette Léger ou Copieux.</p>');
  }

  function infoIngredient(ing) {   // ingrédient du catalogue, ou nouveau
    return ing.nouveau || etat.catalogue.find(function (x) { return x.nom === ing.nom; }) || {};
  }
  function vegeAuto(F) {
    return !F.ingredients.some(function (ing) {
      if (ing.optionnel) return false;
      var i = infoIngredient(ing);
      return i.rayon === 'boucherie' || i.rayon === 'poissonnerie' || NON_VEGE_NOMS.indexOf(ing.nom) !== -1;
    });
  }
  function kcalPortion(F) {
    var t = 0, incomplet = false;   // un ingrédient sans valeurs nutritives -> pas d'étiquette Léger/Copieux
    F.ingredients.forEach(function (ing) {
      var i = infoIngredient(ing);
      if (ing.optionnel) return;
      if (i.kcal_100g == null || (i.unite_base === 'piece' && !i.poids_piece_g)) { incomplet = true; return; }
      var g = i.unite_base === 'piece' ? ing.quantite * (i.poids_piece_g || 0) : ing.quantite;
      t += g * i.kcal_100g / 100;
    });
    return incomplet ? null : t / (Number(F.portions) || 1);
  }
  function libelle(q, unite) {
    var s = String(q).replace('.', ',');
    return unite === 'piece' ? s : s + ' ' + unite;
  }

  // Formulaire prérempli à partir d'une recette existante (modification)
  function formulaireDepuis(r) {
    var F = nouveauFormulaire();
    F.id = r.id;
    F.titre = r.titre; F.description = r.description || ''; F.pays = r.pays || '';
    F.prep = String(r.temps_prep_min); F.cuisson = String(r.temps_cuisson_min); F.portions = r.portions;
    F.froid = !!r.se_mange_froid;
    F.vegeManuel = !!r.vegetarien;
    F.tags = (r.categories || []).filter(function (t) { return ETIQUETTES_MANUELLES.indexOf(t) !== -1; });
    F.ingredients = (r.recette_ingredients || []).filter(function (ri) { return ri.ingredients; }).map(function (ri) {
      return { nom: ri.ingredients.nom, quantite: Number(ri.quantite), optionnel: !!ri.optionnel, nouveau: null, libelle: ri.libelle_quantite };
    });
    F.etapes = (r.etapes || []).map(function (e) {
      return { texte: e.texte, minutes: e.minuteur_s ? String(Math.round(e.minuteur_s / 60)) : '' };
    });
    if (!F.etapes.length) F.etapes = [{ texte: '', minutes: '' }];
    return F;
  }

  function ouvrirFormulaire(c, recette) {
    etat.form = recette ? formulaireDepuis(recette) : nouveauFormulaire();
    try { history.pushState({ formulaire: true }, ''); } catch (err) { /* sans historique */ }
    c.innerHTML = '<p class="chargement">Chargement des ingrédients…</p>';
    chargerCatalogue(etat.ctx.sb).then(function () {
      // Végé redevient automatique si la valeur enregistrée correspond au calcul
      var F = etat.form;
      if (F && F.id && F.vegeManuel === vegeAuto(F)) F.vegeManuel = null;
      if (c.isConnected) rendreFormulaire(c);
    }, function (err) {
      c.innerHTML = '<p class="erreur">' + h(App.traduireErreur(err)) + '</p>';
    });
  }

  function fermerFormulaire(c) {
    var id = etat.form && etat.form.id;
    etat.form = null;
    if (id) { etat.ouverte = id; rendreFiche(c); } else rendreListe(c);
  }

  function rendreFormulaire(c) {
    var F = etat.form;
    var vege = F.vegeManuel === null ? vegeAuto(F) : F.vegeManuel;
    var pays = Array.from(new Set(etat.recettes.map(function (r) { return r.pays; }).filter(Boolean))).sort();
    c.innerHTML =
      '<button type="button" class="retour" id="form-annuler">Annuler</button>' +
      '<h2 class="fiche-titre">' + (F.id ? 'Modifier la recette' : 'Nouvelle recette') + '</h2>' +
      '<div class="formulaire form-recette">' +
        '<label>Nom du plat<input data-champ="titre" maxlength="80" value="' + h(F.titre) + '"></label>' +
        '<label><span>Description <span class="discret">(facultatif)</span></span><input data-champ="description" maxlength="160" value="' + h(F.description) + '"></label>' +
        '<label><span>Pays ou origine <span class="discret">(facultatif)</span></span><input data-champ="pays" list="liste-pays" maxlength="30" value="' + h(F.pays) + '">' +
          '<datalist id="liste-pays">' + pays.map(function (p) { return '<option value="' + h(p) + '">'; }).join('') + '</datalist></label>' +
        '<div class="form-ligne3">' +
          '<label>Préparation<span class="champ-unite"><input data-champ="prep" type="number" inputmode="numeric" min="0" max="600" value="' + h(F.prep) + '"><span>min</span></span></label>' +
          '<label>Cuisson<span class="champ-unite"><input data-champ="cuisson" type="number" inputmode="numeric" min="0" max="600" value="' + h(F.cuisson) + '"><span>min</span></span></label>' +
          '<label>Portions<input data-champ="portions" type="number" inputmode="numeric" min="1" max="20" value="' + h(F.portions) + '"></label>' +
        '</div>' +
        '<fieldset class="form-cases"><legend>Particularités</legend>' +
          '<label><input type="checkbox" data-case="froid"' + (F.froid ? ' checked' : '') + '> Se mange froid (gamelle)</label>' +
          '<label><input type="checkbox" data-case="vege"' + (vege ? ' checked' : '') + '> Végétarienne</label>' +
          ETIQUETTES_MANUELLES.map(function (t) {
            return '<label><input type="checkbox" data-tag="' + h(t) + '"' + (F.tags.indexOf(t) !== -1 ? ' checked' : '') + '> ' + h(t) + '</label>';
          }).join('') +
        '</fieldset>' +

        '<h3>Ingrédients</h3>' +
        '<ul class="form-ingr">' + F.ingredients.map(function (ing, k) {
          var u = infoIngredient(ing).unite_base;
          return '<li><span><strong>' + h(ing.libelle || libelle(ing.quantite, u)) + '</strong> ' + h(ing.nom) +
            (ing.optionnel ? ' <span class="discret">(facultatif)</span>' : '') +
            (ing.nouveau ? ' <span class="badge">nouveau</span>' : '') + '</span>' +
            '<button type="button" class="form-suppr" data-suppr-ingr="' + k + '" aria-label="Retirer ' + h(ing.nom) + '">Retirer</button></li>';
        }).join('') + '</ul>' +
        (F.editeur ? rendreEditeur(F.editeur) : '<button type="button" class="ajouter" id="ingr-ajouter">Ajouter un ingrédient</button>') +

        '<h3>Étapes</h3>' +
        '<ol class="form-etapes">' + F.etapes.map(function (e, k) {
          return '<li><textarea data-etape="' + k + '" rows="2" maxlength="500" aria-label="Étape ' + (k + 1) + '">' + h(e.texte) + '</textarea>' +
            '<div class="form-etape-bas"><span class="champ-unite"><input data-minutes="' + k + '" type="number" inputmode="numeric" min="0" max="600" ' +
            'placeholder="Minuteur" aria-label="Minuteur de l\'étape ' + (k + 1) + ' en minutes" value="' + h(e.minutes) + '"><span>min</span></span>' +
            (F.etapes.length > 1 ? '<button type="button" class="form-suppr" data-suppr-etape="' + k + '">Retirer</button>' : '') + '</div></li>';
        }).join('') + '</ol>' +
        '<button type="button" class="ajouter" id="etape-ajouter">Ajouter une étape</button>' +

        '<p class="erreur" role="alert" id="form-erreur" hidden></p>' +
        '<button type="button" class="bouton" id="form-enregistrer">' + (F.id ? 'Enregistrer les modifications' : 'Enregistrer la recette') + '</button>' +
      '</div>';
    brancherFormulaire(c);
  }

  function rendreEditeur(E) {
    var html = '<div class="editeur-ingr">';
    if (!E.choisi) {
      var t = App.simplifier(E.texte.trim());
      var deja = etat.form.ingredients.map(function (i) { return i.nom; });
      var sugg = t ? etat.catalogue.filter(function (x) {
        return deja.indexOf(x.nom) === -1 && App.simplifier(x.nom).indexOf(t) !== -1;
      }).slice(0, 6) : [];
      var exact = etat.catalogue.some(function (x) { return App.simplifier(x.nom) === t; });
      html += '<label>Ingrédient<input id="ingr-texte" autocomplete="off" maxlength="50" value="' + h(E.texte) + '" placeholder="Ex. : courgette"></label>' +
        '<ul class="suggestions">' + sugg.map(function (x) {
          return '<li><button type="button" data-choisir="' + h(x.nom) + '">' + h(x.nom) + ' <span class="discret">' + UNITES[x.unite_base] + '</span></button></li>';
        }).join('') +
        (t && !exact ? '<li><button type="button" data-creer="1">Créer « ' + h(E.texte.trim()) + ' »</button></li>' : '') + '</ul>';
    } else {
      var i = E.nouveau || etat.catalogue.find(function (x) { return x.nom === E.choisi; });
      html += '<p class="editeur-nom">' + h(E.choisi) + (E.nouveau ? ' <span class="badge">nouveau</span>' : '') + '</p>';
      if (E.nouveau) {
        html += '<div class="form-ligne2">' +
          '<label>Rayon<select data-nouveau="rayon">' + RAYONS.map(function (r) {
            return '<option value="' + r[0] + '"' + (E.nouveau.rayon === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
          '<label>Compté en<select data-nouveau="unite_base">' + Object.keys(UNITES).map(function (u) {
            return '<option value="' + u + '"' + (E.nouveau.unite_base === u ? ' selected' : '') + '>' + UNITES[u] + '</option>'; }).join('') + '</select></label>' +
          '</div>' +
          (E.nouveau.unite_base === 'piece'
            ? '<label><span>Poids d\'une pièce <span class="discret">(facultatif)</span></span><span class="champ-unite"><input data-nouveau="poids_piece_g" type="number" inputmode="decimal" min="1" value="' + h(E.nouveau.poids_piece_g || '') + '"><span>g</span></span></label>' : '') +
          blocCiqual(E.nouveau);
      }
      html += '<label>Quantité pour la recette<span class="champ-unite"><input id="ingr-quantite" type="number" inputmode="decimal" min="0" step="any" value="' + h(E.quantite) + '"><span>' + UNITES[i.unite_base] + '</span></span></label>' +
        '<label class="case"><input type="checkbox" id="ingr-optionnel"' + (E.optionnel ? ' checked' : '') + '> Facultatif</label>' +
        '<p class="erreur" id="ingr-erreur" hidden></p>' +
        '<div class="editeur-boutons"><button type="button" class="bouton" id="ingr-valider">Ajouter</button>' +
        '<button type="button" class="bouton secondaire" id="ingr-annuler">Annuler</button></div>';
    }
    return html + '</div>';
  }

  function brancherFormulaire(c) {
    var F = etat.form;
    var re = function () { rendreFormulaire(c); };
    c.querySelectorAll('[data-champ]').forEach(function (el) {
      el.addEventListener('input', function () { F[el.dataset.champ] = el.value; F.modifie = true; });
    });
    c.querySelector('[data-case="froid"]').addEventListener('change', function (e) { F.froid = e.target.checked; F.modifie = true; });
    c.querySelector('[data-case="vege"]').addEventListener('change', function (e) { F.vegeManuel = e.target.checked; F.modifie = true; });
    c.querySelectorAll('[data-tag]').forEach(function (el) {
      el.addEventListener('change', function () {
        var t = el.dataset.tag;
        F.tags = F.tags.filter(function (x) { return x !== t; });
        if (el.checked) F.tags.push(t);
        F.modifie = true;
      });
    });
    c.querySelectorAll('[data-suppr-ingr]').forEach(function (b) {
      b.addEventListener('click', function () { F.ingredients.splice(Number(b.dataset.supprIngr), 1); re(); });
    });
    c.querySelectorAll('[data-etape]').forEach(function (el) {
      el.addEventListener('input', function () { F.etapes[Number(el.dataset.etape)].texte = el.value; F.modifie = true; });
    });
    c.querySelectorAll('[data-minutes]').forEach(function (el) {
      el.addEventListener('input', function () { F.etapes[Number(el.dataset.minutes)].minutes = el.value; });
    });
    c.querySelectorAll('[data-suppr-etape]').forEach(function (b) {
      b.addEventListener('click', function () { F.etapes.splice(Number(b.dataset.supprEtape), 1); re(); });
    });
    c.querySelector('#etape-ajouter').addEventListener('click', function () {
      F.etapes.push({ texte: '', minutes: '' }); re();
      var zones = c.querySelectorAll('[data-etape]'); zones[zones.length - 1].focus();
    });
    c.querySelector('#form-annuler').addEventListener('click', function () {
      if (F.modifie && !window.confirm('Abandonner cette recette ? Ce qui a été saisi sera perdu.')) return;
      if (history.state && history.state.formulaire) history.back(); else fermerFormulaire(c);
    });
    var ajout = c.querySelector('#ingr-ajouter');
    if (ajout) ajout.addEventListener('click', function () {
      F.editeur = { texte: '', choisi: null, nouveau: null, quantite: '', optionnel: false }; re();
      c.querySelector('#ingr-texte').focus();
    });
    if (F.editeur) brancherEditeur(c, re);
    c.querySelector('#form-enregistrer').addEventListener('click', function () { enregistrer(c); });
  }

  function brancherEditeur(c, re) {
    var E = etat.form.editeur;
    var texte = c.querySelector('#ingr-texte');
    if (texte) {
      texte.addEventListener('input', function () {
        E.texte = texte.value;
        var pos = texte.selectionStart;
        re();
        var t = c.querySelector('#ingr-texte'); t.focus(); try { t.setSelectionRange(pos, pos); } catch (err) { /* */ }
      });
    }
    c.querySelectorAll('[data-choisir]').forEach(function (b) {
      b.addEventListener('click', function () { E.choisi = b.dataset.choisir; re(); c.querySelector('#ingr-quantite').focus(); });
    });
    var creer = c.querySelector('[data-creer]');
    if (creer) creer.addEventListener('click', function () {
      var nom = E.texte.trim();
      E.choisi = nom.charAt(0).toUpperCase() + nom.slice(1);
      E.nouveau = { nom: E.choisi, rayon: 'autre', unite_base: 'g', poids_piece_g: '', ciqual: null, ciqualTexte: nom, kcal_100g: null };
      re();
      if (!etat.ciqual) {
        etat.ciqualErreur = '';
        chargerCiqual(etat.ctx.sb).then(function () { if (etat.form && etat.form.editeur === E) reEditeur(); },
          function (err) { etat.ciqualErreur = App.traduireErreur(err); if (etat.form && etat.form.editeur === E) reEditeur(); });
      }
    });
    // Réaffiche en gardant la quantité déjà tapée
    function reEditeur() {
      E.quantite = (c.querySelector('#ingr-quantite') || {}).value || E.quantite;
      re();
    }
    var cq = c.querySelector('#ciqual-texte');
    if (cq) cq.addEventListener('input', function () {
      E.nouveau.ciqualTexte = cq.value;
      var pos = cq.selectionStart;
      reEditeur();
      var t = c.querySelector('#ciqual-texte'); t.focus(); try { t.setSelectionRange(pos, pos); } catch (err) { /* */ }
    });
    c.querySelectorAll('[data-ciqual]').forEach(function (b) {
      b.addEventListener('click', function () {
        var code = Number(b.dataset.ciqual);
        var ch = etat.ciqual.find(function (x) { return x.code === code; });
        if (!ch) return;
        E.nouveau.ciqual = ch;
        E.nouveau.kcal_100g = kcalCiqual(ch);
        reEditeur();
      });
    });
    var changer = c.querySelector('[data-ciqual-changer]');
    if (changer) changer.addEventListener('click', function () {
      E.nouveau.ciqual = null; E.nouveau.kcal_100g = null;
      reEditeur();
      var t = c.querySelector('#ciqual-texte'); if (t) t.focus();
    });
    c.querySelectorAll('[data-nouveau]').forEach(function (el) {
      el.addEventListener('change', function () {
        E.nouveau[el.dataset.nouveau] = el.value;
        E.quantite = (c.querySelector('#ingr-quantite') || {}).value || E.quantite;
        if (el.dataset.nouveau === 'unite_base') re();
      });
    });
    var q = c.querySelector('#ingr-quantite');
    if (q) q.addEventListener('input', function () { E.quantite = q.value; });
    var opt = c.querySelector('#ingr-optionnel');
    if (opt) opt.addEventListener('change', function () { E.optionnel = opt.checked; });
    var valider = c.querySelector('#ingr-valider');
    if (valider) valider.addEventListener('click', function () {
      var n = Number(String(E.quantite).replace(',', '.'));
      if (!(n > 0)) {
        var p = c.querySelector('#ingr-erreur'); p.textContent = 'Indique une quantité supérieure à 0.'; p.hidden = false; return;
      }
      etat.form.ingredients.push({ nom: E.choisi, quantite: n, optionnel: E.optionnel, nouveau: E.nouveau });
      etat.form.editeur = null;
      etat.form.modifie = true;
      re();
    });
    var annuler = c.querySelector('#ingr-annuler');
    if (annuler) annuler.addEventListener('click', function () { etat.form.editeur = null; re(); });
  }

  function erreurFormulaire(c, texte) {
    var p = c.querySelector('#form-erreur');
    p.textContent = texte; p.hidden = false;
    p.scrollIntoView && p.scrollIntoView({ block: 'center' });
  }

  async function enregistrer(c) {
    var F = etat.form;
    if (etat.occupe) return;
    var titre = F.titre.trim();
    var etapes = F.etapes.filter(function (e) { return e.texte.trim(); });
    var prep = Number(F.prep) || 0, cuisson = Number(F.cuisson) || 0, portions = Math.round(Number(F.portions));
    if (!titre) return erreurFormulaire(c, 'Donne un nom au plat.');
    if (F.editeur) return erreurFormulaire(c, 'Termine ou annule l\'ingrédient en cours avant d\'enregistrer.');
    if (etat.recettes.some(function (r) { return r.id !== F.id && App.simplifier(r.titre) === App.simplifier(titre); }))
      return erreurFormulaire(c, 'Une recette porte déjà ce nom.');
    if (!(portions >= 1 && portions <= 20)) return erreurFormulaire(c, 'Le nombre de portions doit être entre 1 et 20.');
    if (prep < 0 || cuisson < 0) return erreurFormulaire(c, 'Les temps ne peuvent pas être négatifs.');
    if (!F.ingredients.length) return erreurFormulaire(c, 'Ajoute au moins un ingrédient.');
    if (!etapes.length) return erreurFormulaire(c, 'Décris au moins une étape.');

    var vege = F.vegeManuel === null ? vegeAuto(F) : F.vegeManuel;
    var kcal = kcalPortion(F);
    var tags = [];
    if (prep + cuisson <= 30) tags.push('Rapide');
    if (vege) tags.push('Végé');
    if (kcal !== null && kcal > 0 && kcal <= 500) tags.push('Léger');
    if (kcal !== null && kcal >= 750) tags.push('Copieux');
    if (F.froid) tags.push('Gamelle');
    ETIQUETTES_MANUELLES.forEach(function (t) { if (F.tags.indexOf(t) !== -1) tags.push(t); });

    var donnees = {
      titre: titre, description: F.description.trim(), pays: F.pays.trim(), portions: portions,
      temps_prep_min: Math.round(prep), temps_cuisson_min: Math.round(cuisson),
      vegetarien: vege, se_mange_froid: F.froid, categories: tags,
      etapes: etapes.map(function (e) { var m = Number(e.minutes); return { texte: e.texte.trim(), minuteur_s: m > 0 ? Math.round(m * 60) : null }; }),
      // ingrédient du catalogue -> son id ; nouvel ingrédient -> créé par la base dans la même opération
      ingredients: F.ingredients.map(function (i) {
        var d = { quantite: i.quantite, libelle: i.libelle || libelle(i.quantite, infoIngredient(i).unite_base), optionnel: !!i.optionnel };
        if (i.nouveau) d.nouveau = { nom: i.nom, rayon: i.nouveau.rayon, unite_base: i.nouveau.unite_base, poids_piece_g: i.nouveau.poids_piece_g || '',
          ciqual_code: i.nouveau.ciqual ? i.nouveau.ciqual.code : '' };
        else d.ingredient_id = infoIngredient(i).id;
        return d;
      })
    };
    var bouton = c.querySelector('#form-enregistrer');
    etat.occupe = true; bouton.disabled = true;
    var r = F.id ? await etat.ctx.sb.rpc('modifier_recette', { p_id: F.id, p: donnees })
                 : await etat.ctx.sb.rpc('ajouter_recette', { p: donnees });
    etat.occupe = false; bouton.disabled = false;
    if (r.error) {
      var m = r.error.message || '';
      return erreurFormulaire(c, /duplicate key|recettes_foyer_id_titre/.test(m) ? 'Une recette porte déjà ce nom.'
        : App.traduireErreur(r.error));
    }
    // Recharger recettes et catalogue, puis ouvrir la nouvelle fiche
    etat.recettes = null; etat.catalogue = null; etat.form = null;
    try { await charger(etat.ctx.sb); } catch (err) { return rendreListe(c); }
    etat.ouverte = r.data;
    try { history.replaceState({ recette: etat.ouverte }, ''); } catch (err) { /* */ }
    rendreFiche(c);
  }

  // ---------- Suppression ----------
  async function supprimer(c, r) {
    if (etat.occupe) return;
    var err = c.querySelector('#fiche-erreur');
    var u = await etat.ctx.sb.from('planning').select('id').eq('recette_id', r.id);
    var n = (u.data || []).length;
    var msg = 'Supprimer « ' + r.titre + ' » ?' + (n
      ? '\n\nCe plat apparaît ' + n + ' fois dans le planning (historique compris) : ces repas seront retirés aussi.' : '');
    if (!window.confirm(msg)) return;
    etat.occupe = true;
    var d = await etat.ctx.sb.from('recettes').delete().eq('id', r.id);
    etat.occupe = false;
    if (d.error) { err.textContent = App.traduireErreur(d.error); err.hidden = false; return; }
    etat.recettes = etat.recettes.filter(function (x) { return x.id !== r.id; });
    etat.ouverte = null;
    try { if (history.state && history.state.recette) history.replaceState(null, ''); } catch (e) { /* */ }
    rendreListe(c);
  }

  // Bouton retour du téléphone : ferme la fiche au lieu de quitter l'appli
  var conteneurActif = null;
  window.addEventListener('popstate', function () {
    if (!conteneurActif || !document.querySelector('.onglet[data-onglet="recettes"][aria-current="page"]')) return;
    if (etat.form) fermerFormulaire(conteneurActif);
    else if (etat.ouverte && !(history.state && history.state.recette === etat.ouverte)) fermerFiche(conteneurActif);   // sortie du mode cuisine : la fiche reste
  });

  var onglet = {
    id: 'recettes',
    titre: 'Recettes',
    icone: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M9 9h6M9 13h6"/>',
    rendre: async function (c, ctx) {
      conteneurActif = c;
      etat.ctx = ctx;
      etat.form = null;
      etat.ouverte = null;
      if (!etat.recettes) {
        c.innerHTML = '<p class="chargement">Chargement des recettes…</p>';
        try { await charger(ctx.sb); }
        catch (err) {
          c.innerHTML = '<p class="erreur">' + h(App.traduireErreur(err)) + '</p>' +
            '<button type="button" class="bouton secondaire" id="rec-reessayer">Réessayer</button>';
          c.querySelector('#rec-reessayer').addEventListener('click', function () { onglet.rendre(c, ctx); });
          return;
        }
      }
      try { etat.placard = await App.chargerPlacard(ctx.sb); }   // relu à chaque fois : le placard change souvent
      catch (err) { /* pas bloquant : on garde le dernier placard connu */ }
      if (c.isConnected) rendreListe(c);
    }
  };
  App.onglets.push(onglet);
})();
