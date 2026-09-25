/**
 * Evaluation queries for describe-the-plot search, with the films a user would
 * expect to see. Used by `npm run eval:relevance`.
 *
 * Written because relevance was being judged by eyeballing a handful of queries,
 * which cannot tell whether a change helped, hurt, or did nothing. Scoring is
 * hits@10 (did any expected film appear in the top ten) and MRR (how high the
 * first expected film ranked).
 *
 * Two rules learned while building this:
 *
 *  - **The catalogue starts at 1980.** Jaws, Alien, Rocky and Dr. Strangelove
 *    are not in it, so queries expecting them can never be satisfied and inflate
 *    the failure count. The harness reports any title that resolves to nothing.
 *  - **The catalogue holds duplicates of the same name** (two `Godzilla`s, three
 *    `Twilight`s, two `Zodiac`s). A title-only match would score a hit for the
 *    229-vote `Twilight` when the 2008 one was meant, so expectations carry a
 *    year.
 *
 * The last four entries are deliberately obscure cult films with distinctive
 * plots. They are the counterweight to the rest: a ranking that simply favours
 * popularity would pass the blockbuster queries and fail these, which is exactly
 * the failure mode worth catching.
 */
export interface ExpectedFilm {
    title: string;
    year?: number;
}

export interface RelevanceCase {
    query: string;
    expect: ExpectedFilm[];
    note?: string;
}

const f = (title: string, year?: number): ExpectedFilm => ({ title, year });

export const RELEVANCE_QUERIES: RelevanceCase[] = [
    {
        query: "a young wizard learns magic at a school for witches and wizards",
        expect: [f("Harry Potter and the Philosopher's Stone", 2001), f("Harry Potter and the Chamber of Secrets", 2002)],
        note: "Baseline ranked a 61-vote film and an 861-vote film above Harry Potter (30,141 votes).",
    },
    {
        query: "a lonely astronaut stranded alone in space trying to survive",
        expect: [f("Gravity", 2013), f("Moon", 2009), f("The Martian", 2015)],
        note: "Baseline ranked a 243-vote film above The Martian (21,749 votes).",
    },
    {
        query: "a computer hacker discovers reality is a simulation",
        expect: [f("The Matrix", 1999)],
    },
    {
        query: "a detective investigates a series of gruesome murders in a rainy city",
        expect: [f("Se7en", 1995), f("Zodiac", 2007), f("Prisoners", 2013)],
        note: "Baseline returned films with 60-80 votes ahead of anything recognisable.",
    },
    {
        query: "a serial killer leaves cryptic puzzles for the police to solve",
        expect: [f("Se7en", 1995), f("Zodiac", 2007)],
    },
    {
        query: "a dinosaur theme park goes catastrophically wrong",
        expect: [f("Jurassic Park", 1993)],
    },
    {
        query: "toys come alive when humans are not watching",
        expect: [f("Toy Story", 1995)],
    },
    {
        query: "a ring must be destroyed in the fires of a volcano",
        expect: [f("The Lord of the Rings: The Fellowship of the Ring", 2001), f("The Lord of the Rings: The Return of the King", 2003)],
    },
    {
        query: "a giant monster destroys a city",
        expect: [f("Godzilla", 2014)],
    },
    {
        query: "a young woman falls in love with a vampire",
        expect: [f("Twilight", 2008)],
    },
    {
        query: "time travellers try to prevent a war that destroys humanity",
        expect: [f("Edge of Tomorrow", 2014), f("Looper", 2012), f("The Terminator", 1984)],
    },
    {
        query: "children discover a magical world through the back of a wardrobe",
        expect: [f("The Chronicles of Narnia: The Lion, the Witch and the Wardrobe", 2005)],
    },
    {
        query: "a man relives the same day over and over again",
        expect: [f("Groundhog Day", 1993)],
    },
    {
        query: "a group of friends in a cabin are possessed by demons",
        expect: [f("The Evil Dead", 1982)],
    },
    {
        query: "a great white shark terrorises swimmers at the beach",
        expect: [f("The Shallows", 2016), f("Deep Blue Sea", 1999)],
    },
    {
        query: "a spacecraft crew is hunted one by one by a hostile alien",
        expect: [f("Prometheus", 2012), f("Event Horizon", 1997), f("Life", 2017)],
    },
    {
        query: "a boxing underdog gets a shot at the heavyweight title",
        expect: [f("Creed", 2015), f("Million Dollar Baby", 2004), f("The Fighter", 2010)],
    },
    {
        query: "a soldier returns home from war and struggles to adjust to normal life",
        expect: [f("Born on the Fourth of July", 1989), f("American Sniper", 2014)],
    },
    {
        query: "a submarine crew argues over whether to launch nuclear missiles",
        expect: [f("Crimson Tide", 1995)],
    },
    {
        query: "a teenager hacks into military computers and nearly starts a nuclear war",
        expect: [f("WarGames", 1983)],
    },
    {
        query: "a hitman is hired to protect a young girl",
        expect: [f("Léon: The Professional", 1994)],
    },
    {
        query: "a spy with amnesia tries to piece together his identity",
        expect: [f("The Bourne Identity", 2002)],
    },
    {
        query: "a pirate captain searches for treasure on cursed islands",
        expect: [f("Pirates of the Caribbean: The Curse of the Black Pearl", 2003)],
    },
    {
        query: "a mentally ill mathematician hallucinates that his roommate is real",
        expect: [f("A Beautiful Mind", 2001)],
    },
    {
        query: "a group of thieves plan an elaborate casino heist",
        expect: [f("Ocean's Eleven", 2001), f("Heat", 1995)],
    },
    {
        query: "a boy befriends a stray dog",
        expect: [f("Hachi: A Dog's Tale", 2009)],
    },
    {
        query: "a family is terrorised by ghosts in their new house",
        expect: [f("Poltergeist", 1982), f("The Amityville Horror", 2005)],
    },
    {
        query: "a chef rebuilds his life and career after losing everything",
        expect: [f("Chef", 2014), f("Burnt", 2015)],
    },
    {
        query: "a bank employee is forced to help rob his own bank",
        expect: [f("Inside Man", 2006), f("The Bank Job", 2008)],
    },
    {
        query: "two people who keep just missing each other fall in love over many years",
        expect: [f("One Day", 2011), f("Past Lives", 2023)],
    },

    // --- Counterweights: obscure films with distinctive plots. A ranking that
    // --- over-rewards popularity will fail these while passing everything above.
    {
        query: "engineers accidentally invent a time machine in their garage",
        expect: [f("Primer", 2004)],
    },
    {
        query: "a pop idol loses her grip on reality and her own identity",
        expect: [f("Perfect Blue", 1998)],
    },
    {
        query: "a comet passing overhead fractures a dinner party's reality",
        expect: [f("Coherence", 2014)],
    },
    {
        query: "a professor claims to be a caveman who has lived for fourteen thousand years",
        expect: [f("The Man from Earth", 2007)],
    },

    // --- Long-tail guards: films with only a few hundred votes whose plots are
    // --- unmistakable. These are what a prior that is too strong destroys: the
    // --- query is answered precisely by a film nobody has voted on, and a boost
    // --- large enough to always prefer the famous film will bury it.
    {
        query: "a suicidal woman is saved on a Paris bridge by a knife thrower who makes her his target",
        expect: [f("The Girl on the Bridge", 1999)], // 237 votes
    },
    {
        query: "a young man leaves his mountain home to earn enough money to save his late father's farm",
        expect: [f("The Man from Snowy River", 1982)], // 169 votes
        note: "Known model miss: fails at every weight, so it is not a prior problem — the plot text simply does not retrieve.",
    },
    {
        query: "an immortal warrior chases his lover's killer across the centuries",
        expect: [f("Highlander: The Search for Vengeance", 2007)], // 136 votes
    },
    {
        query: "a mother conceives and raises her daughter to become the perfect woman of the future",
        expect: [f("The Red Virgin", 2024)], // 182 votes
    },

    // --- Colloquial queries: the case a rewrite is supposed to earn its keep on.
    // --- Indirect references and shorthand that the plot text does not contain
    // --- literally. If the LLM rewrite cannot beat embedding these as typed, it
    // --- is costing latency and money on the semantic path for nothing.
    {
        query: "the one with the blue aliens on pandora",
        expect: [f("Avatar", 2009)],
    },
    {
        query: "the movie where the kid sees dead people",
        expect: [f("The Sixth Sense", 1999)],
    },
    {
        query: "the spinning top dream movie",
        expect: [f("Inception", 2010)],
    },
    {
        query: "that film about the ship hitting an iceberg",
        expect: [f("Titanic", 1997)],
    },
    {
        query: "the one about erasing someone from your memory after a breakup",
        expect: [f("Eternal Sunshine of the Spotless Mind", 2004)],
    },
];
