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
    prix: [], magasins: [], magasin: App.lire('magasin', ''), prixPour: null };
  var CHAMPS_ART = 'id, ingredient_id, libelle_libre, quantite, coche, prix_paye_eur';
  var CHAMPS_PRIX = 'ingredient_id, magasin_id, prix_eur, quantite, releve_le, source';
  var UNITES_ACHAT = { g: [['g', 1], ['kg', 1000]], ml: [['ml', 1], ['cl', 10], ['L', 1000]], piece: [['pièce(s)', 1]] };

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
  // Repas déjà cuisinés (cuisine_le) exclus : leurs ingrédients ont été utilisés (et retirés du placard).
  // Ingrédients facultatifs et ingrédients retirés d'un repas exclus.
  // Placard/frigo : quantité inconnue = "on en a" -> exclu ; quantité connue -> déduite.
  App.calculerCourses = function (repas, recettes, ingredients, stock) {
    var recParId = {}, ingParNom = {}, stockParId = {}, besoins = {};
    recettes.forEach(function (r) { recParId[r.id] = r; });
    ingredients.forEach(function (i) { ingParNom[i.nom] = i; });
    stock.forEach(function (s) { stockParId[s.ingredient_id] = s; });
    repas.forEach(function (p) {
      if (p.reste_de || p.cuisine_le) return;
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
    var recent = function (a, b) {   // le plus récent d'abord ; à date égale, le ticket avant la référence
      return String(b.releve_le || '').localeCompare(String(a.releve_le || '')) || (b.source === 'ticket') - (a.source === 'ticket');
    };
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
  App.eurosCentimes = function (x) {
    return Number(x).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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
      sb.from('planning').select('id, jour, recette_id, portions, reste_de, ingredients_retires, cuisine_le')
        .gte('jour', App.dateISO(debut)).lte('jour', App.dateISO(fin)),
      sb.from('ingredients').select('id, nom, rayon, unite_base'),
      sb.from('stock').select('ingredient_id, quantite'),
      sb.from('liste_articles').select(CHAMPS_ART).eq('semaine', App.dateISO(lundi)).order('id'),
      sb.from('prix').select(CHAMPS_PRIX),
      sb.from('magasins').select('id, nom, coefficient').order('nom')
    ]);
    for (var k = 1; k < 5; k++) if (res[k].error) throw res[k].error;
    etat.prix = res[5].error ? [] : res[5].data || [];   // sans prix, la liste reste utilisable
    etat.magasins = res[6].error ? [] : res[6].data || [];
    etat.periode = { debut: debut, fin: fin, lundi: App.dateISO(lundi) };
    etat.nbRepas = res[1].data.filter(function (p) { return !p.reste_de && !p.cuisine_le; }).length;
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
      var payes = etat.articles.filter(function (a) { return a.prix_paye_eur != null; });
      if (payes.length) {
        var paye = payes.reduce(function (s, a) { return s + Number(a.prix_paye_eur); }, 0);
        var comparables = payes.filter(function (a) { return a.ingredient_id && E.couts[a.ingredient_id] != null; });
        var estime = comparables.reduce(function (s, a) { return s + E.couts[a.ingredient_id]; }, 0);
        html += '<p class="paye">Payé <strong>' + App.eurosCentimes(paye) + '</strong> pour ' + payes.length + (payes.length > 1 ? ' articles' : ' article') +
          (comparables.length ? ' (estimé ' + App.euros(estime) + (comparables.length < payes.length ? ' pour ' + comparables.length : '') + ')' : '') + '</p>';
      } else if (coches) {
        html += '<p class="paye discret">Appui long sur un article pour noter son prix.</p>';
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
              b.plats.join(', '), a && a.coche, false, a && a.prix_paye_eur);
          }).join('') + '</ul></section>';
      });
      html += '<section class="rayon"><h2>Divers</h2><ul class="courses-liste">' +
        libres.map(function (a) { return ligne('lib:' + a.id, a.libelle_libre, '', '', a.coche, true, a.prix_paye_eur); }).join('') + '</ul>' +
        '<div class="courses-ajout"><input type="text" id="libre-texte" maxlength="60" placeholder="Autre chose (essuie-tout, café…)" aria-label="Ajouter un article">' +
        '<button type="button" class="bouton" id="libre-ajouter">Ajouter</button></div></section>';
      html += '</div>';   // fin de la feuille
      if (L.aLaMaison.length) {
        html += '<details class="a-la-maison"><summary>Déjà à la maison (' + L.aLaMaison.length + ')</summary><ul>' +
          L.aLaMaison.map(function (b) { return '<li>' + h(b.ingredient.nom) + '</li>'; }).join('') + '</ul></details>';
      }
    }
    if (etat.prixPour) html += feuillePrix(etat.prixPour);
    c.innerHTML = html;

    c.querySelectorAll('.sem-fleche').forEach(function (b) {
      b.addEventListener('click', function () { etat.decalage += Number(b.dataset.sens); etat.erreur = ''; etat.prixPour = null; recharger(c, ctx); });
    });
    c.querySelectorAll('.article').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.appuiLong) { delete b.dataset.appuiLong; return; }   // l'appui long a ouvert la saisie du prix
        basculer(c, ctx, b.dataset.cle);
      });
      appuiLong(b, function () { b.dataset.appuiLong = '1'; ouvrirPrix(c, ctx, b.dataset.cle); });
    });
    brancherPrix(c, ctx);
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

  function ligne(cle, nom, qte, plats, coche, libre, paye) {
    var avecPrix = paye != null;
    return '<li class="' + (coche ? 'coche' : '') + '">' +
      '<button type="button" class="article' + (avecPrix ? ' avec-prix' : '') + '" data-cle="' + h(cle) + '" aria-pressed="' + !!coche + '">' +
        '<span class="case-courses" aria-hidden="true"></span>' +
        '<span class="article-nom">' + h(nom) + (plats ? '<small>' + h(plats) + '</small>' : '') + '</span>' +
        (qte || avecPrix ? '<span class="article-qte">' + h(qte) + '</span>' : '') +
        (avecPrix ? '<span class="article-prix">' + App.eurosCentimes(paye) + '</span>' : '') +
      '</button>' +
      (libre ? '<button type="button" class="form-suppr" data-retirer="' + h(cle.slice(4)) + '" aria-label="Retirer ' + h(nom) + '">Retirer</button>' : '') +
    '</li>';
  }

  // ---------- Prix payé (appui long sur un article) ----------
  function appuiLong(el, action) {
    var minuteur = null, x = 0, y = 0;
    var annuler = function () { clearTimeout(minuteur); minuteur = null; };
    el.addEventListener('pointerdown', function (e) {
      x = e.clientX; y = e.clientY; annuler();
      minuteur = setTimeout(function () { minuteur = null; action(); }, 550);
    });
    el.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - x) > 10 || Math.abs(e.clientY - y) > 10) annuler(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { el.addEventListener(t, annuler); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); if (minuteur) { annuler(); action(); } else if (!el.dataset.appuiLong) action(); });
  }

  function infosArticle(cle) {
    var libre = cle.indexOf('lib:') === 0, id = cle.slice(4);
    var a = libre ? etat.articles.find(function (x) { return String(x.id) === id; }) : articleDe(id);
    var b = libre ? null : etat.liste.aAcheter.find(function (x) { return x.ingredient.id === id; });
    return { libre: libre, id: id, article: a, nom: libre ? (a && a.libelle_libre) : (b && b.ingredient.nom), unite: b ? b.ingredient.unite_base : null,
      qte: b ? App.quantiteCourses(b.quantite, b.ingredient.unite_base) : '' };
  }

  function feuillePrix(cle) {
    var I = infosArticle(cle), p = I.article && I.article.prix_paye_eur;
    var mag = etat.magasins.find(function (m) { return m.id === etat.magasin; });
    return '<div class="prix-fond" id="prix-fond"></div>' +
      '<div class="prix-feuille" role="dialog" aria-modal="true" aria-labelledby="prix-titre">' +
        '<p class="prix-titre" id="prix-titre">' + h(I.nom || '') + (I.qte ? ' <span class="discret">' + h(I.qte) + '</span>' : '') + '</p>' +
        '<label class="prix-champ"><span>Prix payé' + (mag ? ' chez ' + h(mag.nom) : '') + '</span>' +
          '<span class="champ-unite"><input id="prix-valeur" type="text" inputmode="decimal" autocomplete="off" maxlength="8" placeholder="0,00" value="' +
          (p != null ? h(String(Number(p)).replace('.', ',')) : '') + '"><span>€</span></span></label>' +
        (I.unite ? '<label class="prix-champ"><span>Quantité achetée <span class="discret">(facultatif)</span></span>' +
          '<span class="prix-qte"><input id="prix-qte" type="text" inputmode="decimal" autocomplete="off" maxlength="7" aria-label="Quantité achetée">' +
          '<select id="prix-unite" aria-label="Unité">' + UNITES_ACHAT[I.unite].map(function (u, k) {
            return '<option value="' + u[1] + '"' + (k === (I.unite === 'piece' ? 0 : 1) ? ' selected' : '') + '>' + u[0] + '</option>';
          }).join('') + '</select></span>' +
          '<small class="discret">Ex. 1 L pour la bouteille : le prix servira aux prochaines estimations.</small></label>' : '') +
        '<p class="erreur" role="alert" id="prix-erreur" hidden></p>' +
        '<div class="editeur-boutons"><button type="button" class="bouton secondaire" id="prix-annuler">Annuler</button>' +
          '<button type="button" class="bouton" id="prix-enregistrer">Enregistrer</button></div>' +
        (p != null ? '<button type="button" class="form-suppr prix-effacer" id="prix-effacer">Effacer le prix</button>' : '') +
      '</div>';
  }

  function ouvrirPrix(c, ctx, cle) {
    if (etat.occupe) return;
    var I = infosArticle(cle);
    if (!I.nom) return;
    etat.prixPour = cle;
    rendre(c, ctx);
    var champ = c.querySelector('#prix-valeur');
    if (champ) { champ.focus(); try { champ.select(); } catch (e) { /* */ } }
  }

  function brancherPrix(c, ctx) {
    if (!etat.prixPour) return;
    var fermer = function () { etat.prixPour = null; rendre(c, ctx); };
    c.querySelector('#prix-annuler').addEventListener('click', fermer);
    c.querySelector('#prix-fond').addEventListener('click', fermer);
    c.querySelector('#prix-enregistrer').addEventListener('click', function () { enregistrerPrix(c, ctx, c.querySelector('#prix-valeur').value); });
    var pq = c.querySelector('#prix-qte');
    if (pq) pq.addEventListener('keydown', function (e) { if (e.key === 'Enter') enregistrerPrix(c, ctx, c.querySelector('#prix-valeur').value); });
    c.querySelector('#prix-valeur').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') enregistrerPrix(c, ctx, e.target.value);
      if (e.key === 'Escape') fermer();
    });
    var ef = c.querySelector('#prix-effacer');
    if (ef) ef.addEventListener('click', function () { enregistrerPrix(c, ctx, null); });
  }

  App.lirePrix = function (texte) {   // "2,35" ou "2.35 €" -> 2.35 ; null si invalide
    var t = String(texte == null ? '' : texte).replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    var n = Number(t);
    return n <= 9999 ? n : null;
  };

  async function enregistrerPrix(c, ctx, texte) {
    if (etat.occupe || !etat.prixPour) return;
    var I = infosArticle(etat.prixPour), valeur = null;
    if (texte !== null) {
      valeur = App.lirePrix(texte);
      if (valeur === null) {
        var pe = c.querySelector('#prix-erreur');
        pe.textContent = 'Prix invalide : écris par exemple 2,35.'; pe.hidden = false;
        return;
      }
    }
    var achat = null;   // quantité achetée, en unité de base
    var qteTexte = c.querySelector('#prix-qte') ? c.querySelector('#prix-qte').value.trim() : '';
    if (valeur !== null && qteTexte) {
      var nq = Number(qteTexte.replace(',', '.'));
      if (!isFinite(nq) || nq <= 0 || nq > 100000) {
        var pq = c.querySelector('#prix-erreur');
        pq.textContent = 'Quantité invalide : écris par exemple 1 ou 0,5.'; pq.hidden = false;
        return;
      }
      achat = nq * Number(c.querySelector('#prix-unite').value);
    }
    var champs = { prix_paye_eur: valeur, magasin_id: valeur === null ? null : (etat.magasin || null) };
    if (valeur !== null && !(I.article && I.article.coche)) {   // payé = dans le caddie
      champs.coche = true; champs.coche_par = ctx.moi.user_id; champs.coche_le = new Date().toISOString();
    }
    etat.occupe = true;
    var r;
    if (I.article) {
      r = await ctx.sb.from('liste_articles').update(champs).eq('id', I.article.id);
      if (!r.error) Object.assign(I.article, champs);
    } else {
      r = await ctx.sb.from('liste_articles').insert(Object.assign({ semaine: etat.periode.lundi, ingredient_id: I.id }, champs))
        .select(CHAMPS_ART).single();
      if (!r.error) etat.articles.push(r.data);
    }
    etat.occupe = false;
    if (r.error && /duplicate key/.test(r.error.message || '')) {   // l'autre téléphone l'a coché entre-temps
      etat.prixPour = null;
      return recharger(c, ctx).then(function () { if (afficheeMaintenant()) ouvrirPrix(c, ctx, 'ing:' + I.id); });
    }
    if (r.error) {
      if (!afficheeMaintenant()) return;
      var p = c.querySelector('#prix-erreur'); p.textContent = App.traduireErreur(r.error); p.hidden = false;
      return;
    }
    etat.prixPour = null;
    etat.erreur = '';
    if (achat && valeur > 0) etat.erreur = await retenirPrix(ctx, I.id, valeur, achat);
    if (afficheeMaintenant()) rendre(c, ctx);
  }

  // Ticket : on ne garde que le dernier prix relevé par ingrédient et par magasin (aucun magasin = magasin moyen)
  async function retenirPrix(ctx, ingredientId, valeur, achat) {
    var mag = etat.magasin && etat.magasins.some(function (m) { return m.id === etat.magasin; }) ? etat.magasin : null;
    var d = ctx.sb.from('prix').delete().eq('ingredient_id', ingredientId).eq('source', 'ticket');
    d = mag ? d.eq('magasin_id', mag) : d.is('magasin_id', null);
    var r = await d;
    if (!r.error) r = await ctx.sb.from('prix').insert({ ingredient_id: ingredientId, magasin_id: mag, prix_eur: valeur, quantite: achat, source: 'ticket' })
      .select(CHAMPS_PRIX).single();
    if (r.error) return 'Prix payé noté, mais pas retenu pour les estimations : ' + App.traduireErreur(r.error);
    etat.prix = etat.prix.filter(function (p) { return !(p.ingredient_id === ingredientId && p.source === 'ticket' && (p.magasin_id || null) === mag); });
    etat.prix.push(r.data);
    return '';
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
        .select(CHAMPS_ART).single();
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
      .select(CHAMPS_ART).single();
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
    if (etat.occupe || etat.prixPour) return planifierActualisation();   // pas pendant une saisie de prix
    var r = await contexte.sb.from('liste_articles').select(CHAMPS_ART)
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
      etat.prixPour = null;
      ecouter(ctx, c);
      return recharger(c, ctx).then(gererEcran);
    }
  });
})();
