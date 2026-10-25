import { createCn } from "cn/config"

/**
 * Class-name join + Tailwind conflict resolution.
 *
 * Configured with NearbyNudge's type scale (index.css `@theme`) so `text-lead`,
 * `text-head` and friends are treated as font sizes, not text colours. Without
 * this, `cn("text-lead", "text-edge")` would drop the size.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro",
            "meta",
            "ui",
            "body",
            "lead",
            "head",
            "title",
            "display",
          ],
        },
      ],
    },
  },
})
