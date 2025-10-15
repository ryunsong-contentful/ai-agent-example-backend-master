declare module 'balanced-match' {
  type MatchResult = {
    start: number
    end: number
    pre: string
    body: string
    post: string
  } | null

  /**
   * Find a pair of balanced delimiters in a string.
   * @param open opening delimiter
   * @param close closing delimiter
   * @param str string to search
   */
  function balancedMatch(open: string, close: string, str: string): MatchResult

  export = balancedMatch
}
declare module 'balanced-match';
