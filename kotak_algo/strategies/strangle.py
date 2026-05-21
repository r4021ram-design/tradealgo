from __future__ import annotations

from kotak_algo.strategies.base_strategy import BaseStrategy


class StrangleStrategy(BaseStrategy):
    def build_legs(self) -> list[dict]:
        selection = self.strike_selector.select_strangle(
            underlying=self.config["underlying"],
            exchange_segment=self.config["exchange_segment"],
            strike_gap=self.config["strike_gap"],
            strangle_gap=self.config["strangle_gap"],
            instrument_type=self.config.get("instrument_type"),
        )
        common = {
            "exchange_segment": self.config["exchange_segment"],
            "product": self.config["product"],
            "lots": self.config["lots"],
            "lot_size": self.config["lot_size"],
            "strategy": self.name,
        }
        return [
            {**common, **selection["ce"], "tag": f"{self.name}-ce"},
            {**common, **selection["pe"], "tag": f"{self.name}-pe"},
        ]

