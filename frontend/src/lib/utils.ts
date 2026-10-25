import { createCn } from "cn/config"

/**
 * Class-name join + Tailwind conflict resolution.
 *
 * Configured with NearbyNudge's custom type scale so `text-list`,
 * `text-email` and friends are treated as font sizes (not text colors) and
 * never cancel out `text-muted-foreground` and similar color utilities.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "page-title",
            "pane-title",
            "email",
            "ui",
            "list",
            "meta",
            "headline",
          ],
        },
      ],
    },
  },
})
