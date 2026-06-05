from __future__ import annotations

from typing import Any
from kotak_algo.strategies.base_strategy import BaseStrategy


class IronCondorStrategy(BaseStrategy):
    def build_legs(self) -> list[dict[str, Any]]:
        selection = self.strike_selector.select_iron_condor(
            underlying=self.config["underlying"],
            exchange_segment=self.config["exchange_segment"],
            strike_gap=self.config["strike_gap"],
            strangle_gap=self.config["strangle_gap"],
            condor_gap=self.config["condor_gap"],
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
            # Long Call (Buy Leg)
            {**common, **selection["long_ce"], "transaction_type": "B", "tag": f"{self.name}-long_ce"},
            # Long Put (Buy Leg)
            {**common, **selection["long_pe"], "transaction_type": "B", "tag": f"{self.name}-long_pe"},
            # Short Call (Sell Leg)
            {**common, **selection["short_ce"], "transaction_type": "S", "tag": f"{self.name}-short_ce"},
            # Short Put (Sell Leg)
            {**common, **selection["short_pe"], "transaction_type": "S", "tag": f"{self.name}-short_pe"},
        ]
