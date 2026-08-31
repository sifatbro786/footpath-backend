// scripts/seedImages.js
//
// One source of truth for every photograph the seed scripts use, shared by
// seedStorefront.js (hero plates, category tiles) and seedProducts.js
// (product galleries).
//
// ⚠️ DEVELOPMENT IMAGERY. Replace all of it with real product photography
// before launch, through /admin/products, /admin/categories and
// /admin/hero-items. None of this is Elmate's own work.
//
// ── Why these URLs and not prettier stock photos ─────────────────────────────
//
// The previous version of this map held guessed Unsplash photo ids. Unsplash
// has no keyless search, so the ids were never checked against what they
// actually show, and most were wrong in ways nobody noticed until the
// storefront filled up with them: the "fountain pen" was a wall of Pepsi cans,
// the "pencils" tile was a concert hall, "art supplies" was a makeup palette,
// and the sketchbook id 404'd outright.
//
// So every URL below was fetched and looked at before it was pinned here, and
// each credit line names what is actually in the frame. Two rules keep it that
// way:
//
//   1. Never add a URL you have not opened. A plausible filename is not
//      evidence: `Sketch-book.jpg` could be anything.
//   2. Keep the credit line accurate. It is what lets the next person tell a
//      dead link apart from a wrong one.
//
// Sources are Wikimedia Commons and Openverse (Flickr, WordPress Photos),
// filtered to CC0, public domain, CC BY and CC BY-SA. Attribution is recorded
// in each `credit` — honour it if any of this ever ships publicly, which it
// should not.
//
// ── Wikimedia URL shapes, the one trap here ──────────────────────────────────
//
// upload.wikimedia.org serves thumbnails only at a fixed set of widths (500,
// 960, 1280 and 1920 among them). An invented width does NOT fall back to the
// nearest allowed size — it returns 400 with "Use thumbnail sizes listed on
// ...". So every `/thumb/<a>/<ab>/<file>/<width>px-<file>` URL below uses an
// allowed width, and any file whose original is already small enough is linked
// at its original path, with no /thumb/ segment at all. If you swap an image,
// re-check the URL rather than editing the width in place.

/**
 * key -> { url, credit }
 *
 * `credit` is "what is in the photo — author, licence, source". Keeping the
 * subject in there is deliberate: it is how this map gets reviewed for
 * relevance without opening forty-odd tabs.
 */
const IMAGES = {
    // ── Notebooks & journals ────────────────────────────────────────────
    leuchtturmA: {
        url: "https://live.staticflickr.com/731/33126570872_f9e86caf27_b.jpg",
        credit: "Stack of hardbound notebooks — jonas.lowgren, CC BY, Flickr",
    },
    leuchtturmB: {
        url: "https://live.staticflickr.com/3953/32439319354_ae8590d3e5_b.jpg",
        credit: "Hardbound notebooks, second angle — jonas.lowgren, CC BY, Flickr",
    },
    moleskineA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/6/6e/Moleskine_ruled_notebook%2C_inside_view.jpg",
        credit: "Moleskine ruled notebook, open — Sembazuru, CC BY-SA 2.0, Wikimedia Commons",
    },
    moleskineB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Moleskine_notebook_-_2019.jpg/1280px-Moleskine_notebook_-_2019.jpg",
        credit: "Moleskine notebook, closed — Sikander Iqbal, CC BY-SA 4.0, Wikimedia Commons",
    },
    fieldNotesA: {
        url: "https://live.staticflickr.com/95/238003766_68e77ce6bf_b.jpg",
        credit: "Pocket memo pads — J Dueck, CC BY, Flickr",
    },
    fieldNotesB: {
        url: "https://live.staticflickr.com/8369/29255277943_d5f018b9b0_b.jpg",
        credit: "Slim patterned pocket notebooks — goblinbox, CC BY, Flickr",
    },
    sketchbookA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/9/9d/Sketch-book.jpg",
        credit: "Blank spiral sketchbook with pencil — sanya, public domain, Wikimedia Commons",
    },
    sketchbookB: {
        url: "https://live.staticflickr.com/7075/7137490527_92f01c56b9_b.jpg",
        credit: "Blank sketchbook — Wonderlane, CC BY, Flickr",
    },
    rhodiaA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Daily_Arsenal_12_22_2010_%285283353038%29.jpg/1280px-Daily_Arsenal_12_22_2010_%285283353038%29.jpg",
        credit: "Fountain pens on a dot grid pad — Charles Barilleaux, CC BY 2.0, Wikimedia Commons",
    },
    rhodiaB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/4/46/-dailyarsenal_1945_Parker_Vacumatic_-fountainpen%2C_Monte_Verde_One_Touch_BP_-ipad_stylus%2C_and_a_Rhodia_No_13_pad_%285853352583%29.jpg",
        credit: "Rhodia No 13 pad with fountain pens — Charles Barilleaux, CC BY 2.0, Wikimedia Commons",
    },
    notebookStack: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/SML_Notebooks_20090903.10D.52443_SML_%283882941631%29.jpg/1280px-SML_Notebooks_20090903.10D.52443_SML_%283882941631%29.jpg",
        credit: "Stacked notebooks — See-ming Lee, CC BY-SA 2.0, Wikimedia Commons",
    },
    journalBlack: {
        url: "https://live.staticflickr.com/4099/4827013488_60953318d3_b.jpg",
        credit: "Black notebook with pen and glasses — Generationbass.com, CC BY, Flickr",
    },

    // ── Writing instruments ─────────────────────────────────────────────
    lamyCharcoalA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Lamy_Fountain_Pens.jpg/1280px-Lamy_Fountain_Pens.jpg",
        credit: "Row of LAMY Safari fountain pens — Bill Bradford, CC BY 2.0, Wikimedia Commons",
    },
    lamyCharcoalB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/4/4c/Lamy_Vista%2C_Lamy_Safari_and_Lamy_AL-star.jpg",
        credit: "LAMY Vista, Safari and AL-star — vinyleraser, CC BY-SA 2.0, Wikimedia Commons",
    },
    lamyRedA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Safari_%285035078230%29.jpg/1280px-Safari_%285035078230%29.jpg",
        credit: "Red LAMY Safari pens — John Morgan, CC BY 2.0, Wikimedia Commons",
    },
    lamyRedB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Lamy_converters.jpg/1280px-Lamy_converters.jpg",
        credit: "LAMY nibs and converters, black and red — Francis Flinch, CC BY-SA 4.0, Wikimedia Commons",
    },
    pilotMetroA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Pilot_Metropolitan_%2826430911443%29.jpg/1280px-Pilot_Metropolitan_%2826430911443%29.jpg",
        credit: "Pilot Metropolitan fountain pen — M Dreibelbis, CC BY 2.0, Wikimedia Commons",
    },
    pilotMetroB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Pilot_Metropolitan_silver_with_python_design.jpg/1280px-Pilot_Metropolitan_silver_with_python_design.jpg",
        credit: "Pilot Metropolitan in its case — Dllu, CC BY-SA 4.0, Wikimedia Commons",
    },
    bicA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/4_Bic_Cristal_pens_and_caps.jpg/1280px-4_Bic_Cristal_pens_and_caps.jpg",
        credit: "BIC Cristal ballpoints, four colours — Carlos Delgado, CC BY-SA 3.0, Wikimedia Commons",
    },
    bicB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Blue_and_red_BIC_Cristal_pen_caps.jpg/1280px-Blue_and_red_BIC_Cristal_pen_caps.jpg",
        credit: "BIC Cristal caps, blue and red — Carlos Delgado, CC BY-SA 3.0, Wikimedia Commons",
    },
    g2A: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Pilot_pens.jpg/1280px-Pilot_pens.jpg",
        credit: "Pilot gel pens — Peter Lindberg, CC BY 2.0, Wikimedia Commons",
    },
    g2B: {
        url: "https://upload.wikimedia.org/wikipedia/commons/5/5b/Pilot_pens_cropped.jpg",
        credit: "Pilot gel pens, close crop — Peter Lindberg, CC BY 2.0, Wikimedia Commons",
    },
    gelPens: {
        url: "https://live.staticflickr.com/484/32515688371_ef9d363686_b.jpg",
        credit: "Coloured gel pens — nick.amoscato, CC BY, Flickr",
    },
    rotringA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Rotring_600_mechanical_pencil_0.5_mm_silver.jpg/1280px-Rotring_600_mechanical_pencil_0.5_mm_silver.jpg",
        credit: "Rotring 600 0.5mm mechanical pencil with box — Alex P. Kok, CC BY-SA 4.0, Wikimedia Commons",
    },
    rotringB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/MITSUBISHI_PENCIL_UNI_KURU_TOGA_0.5_MECHINICAL_PENCIL.jpg/1280px-MITSUBISHI_PENCIL_UNI_KURU_TOGA_0.5_MECHINICAL_PENCIL.jpg",
        credit: "0.5mm mechanical pencil, side view — Dinkun Chen, CC BY-SA 4.0, Wikimedia Commons",
    },
    blackwingA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Palomino_Blackwing_602.jpg/1280px-Palomino_Blackwing_602.jpg",
        credit: "Blackwing 602 pencil and box — Wing602people, CC BY-SA 4.0, Wikimedia Commons",
    },
    blackwingB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Blackwing_pencil_cropped.jpg/1280px-Blackwing_pencil_cropped.jpg",
        credit: "Blackwing pencil, close crop — Wing602people, CC BY-SA 4.0, Wikimedia Commons",
    },
    pencilsGraphite: {
        url: "https://upload.wikimedia.org/wikipedia/commons/5/56/Speciality_artists_pencils_051907.jpg",
        credit: "Sharpened graphite pencils — Mrs Scarborough, public domain, Wikimedia Commons",
    },
    pencilsColour: {
        url: "https://upload.wikimedia.org/wikipedia/commons/8/8f/Seven_Coloured_Pencils_%28ProPhoto_RGB%29.jpg",
        credit: "Seven coloured pencils — Colin, CC BY-SA 4.0, Wikimedia Commons",
    },
    inkA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Pelikan_Tintenglas_Brillant-Schwarz_4001-7718.jpg/1280px-Pelikan_Tintenglas_Brillant-Schwarz_4001-7718.jpg",
        credit: "Pelikan 4001 ink bottle — Raimond Spekking, CC BY-SA 4.0, Wikimedia Commons",
    },
    inkB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Pelikan_ink.JPG/1280px-Pelikan_ink.JPG",
        credit: "Pelikan 4001 ink, bottle and carton — Ennui, public domain, Wikimedia Commons",
    },
    inkTrio: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Pens_and_ink_%285964948286%29.jpg/1280px-Pens_and_ink_%285964948286%29.jpg",
        credit: "Three ink bottles with fountain pens — Jose Camões Silva, CC BY 2.0, Wikimedia Commons",
    },
    penNib: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Two-Tone_Fountain_Pen_Nib-Plum.jpg/1280px-Two-Tone_Fountain_Pen_Nib-Plum.jpg",
        credit: "Two-tone fountain pen nib — ElooKoN, CC BY-SA 4.0, Wikimedia Commons",
    },
    penWriting: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Fountain_pen_writing_%28literacy%29.jpg/1280px-Fountain_pen_writing_%28literacy%29.jpg",
        credit: "Writing with a fountain pen — Petar Milošević, CC BY-SA 4.0, Wikimedia Commons",
    },
    deskPens: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Desk_pen_-_2.jpg/1280px-Desk_pen_-_2.jpg",
        credit: "Three fountain pens on a desk — Tomidaooooooo, CC BY 4.0, Wikimedia Commons",
    },

    // ── Desk & office ───────────────────────────────────────────────────
    organiserA: {
        url: "https://live.staticflickr.com/5571/29633962454_f089179f54_b.jpg",
        credit: "Wooden desk organiser, pencil holder — ZERGE_VIOLATOR, CC BY, Flickr",
    },
    organiserB: {
        url: "https://live.staticflickr.com/8742/30229628306_cb43c2bc22_b.jpg",
        credit: "Wooden desk organiser holding pencils — ZERGE_VIOLATOR, CC BY, Flickr",
    },
    washiA: {
        url: "https://pd.w.org/2026/04/17869d1097d892841.71224611-2048x1536.jpg",
        credit: "Assorted washi tape rolls — cnaito, CC0, WordPress Photo Directory",
    },
    washiB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/A_Roll_of_Masking_Tape_%2832410678777%29.jpg/1280px-A_Roll_of_Masking_Tape_%2832410678777%29.jpg",
        credit: "Roll of paper tape — HireAHelper, CC BY 2.0, Wikimedia Commons",
    },
    boxA: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Hollinger_box_%28angle_view%29.jpg/1280px-Hollinger_box_%28angle_view%29.jpg",
        credit: "Lidded document box, angled — WilliamDenton, CC0, Wikimedia Commons",
    },
    boxB: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Hollinger_box_%28front_view%29.jpg/1280px-Hollinger_box_%28front_view%29.jpg",
        credit: "Lidded document box, front — WilliamDenton, CC0, Wikimedia Commons",
    },
    filingFolders: {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/European_style_folders_dossiers.jpg/1280px-European_style_folders_dossiers.jpg",
        credit: "Lever arch files on a shelf — CC0, Wikimedia Commons",
    },
    filingPaper: {
        url: "https://live.staticflickr.com/7289/8746546945_60f46af9db_b.jpg",
        credit: "Stacked document folders — erix!, CC BY, Flickr",
    },
    shopInterior: {
        url: "https://live.staticflickr.com/8496/8347831015_3a7da4242d_b.jpg",
        credit: "Stationery shop interior — shankar s., CC BY, Flickr",
    },
};

/**
 * Look up a photo URL by key.
 *
 * Throws on an unknown key rather than returning undefined. A typo here used to
 * surface as a silently blank tile on the storefront, three layers away from
 * the cause. Failing at seed time costs one line of output instead of an
 * afternoon.
 */
export function photo(key) {
    const entry = IMAGES[key];
    if (!entry) {
        throw new Error(
            `seedImages: no photo named "${key}". Known keys: ${Object.keys(IMAGES).join(", ")}`,
        );
    }
    return entry.url;
}

export default IMAGES;
