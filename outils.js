// Outils partagés par tous les fichiers
window.App = { onglets: [] };

// Échappe le texte avant de l'insérer dans la page
App.h = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

// Petits réglages mémorisés sur le téléphone (onglet ouvert, etc.)
App.lire = function (cle, defaut) {
  try { var v = localStorage.getItem('atable.' + cle); return v === null ? defaut : JSON.parse(v); }
  catch (e) { return defaut; }
};
App.ecrire = function (cle, valeur) {
  try { localStorage.setItem('atable.' + cle, JSON.stringify(valeur)); } catch (e) { /* stockage indisponible */ }
};

// Messages d'erreur lisibles
App.traduireErreur = function (err) {
  var m = (err && (err.message || String(err))) || '';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(m)) return "Cet e-mail n'est pas encore confirmé dans Supabase.";
  if (/Code invalide/.test(m)) return 'Ce code ne correspond à aucun foyer. Vérifie les 8 caractères.';
  if (/Déjà membre/.test(m)) return "Ce compte fait déjà partie d'un foyer.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Pas de connexion internet. Réessaie dans un instant.';
  return 'Erreur : ' + m;
};

// Icône au trait (contenu SVG fourni par chaque onglet)
App.icone = function (contenu) {
  return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + contenu + '</svg>';
};

// Écran vide d'un onglet pas encore construit
App.ecranVide = function (titre, texte) {
  return '<div class="vide"><p class="vide-titre">' + App.h(titre) + '</p><p>' + App.h(texte) + '</p></div>';
};
