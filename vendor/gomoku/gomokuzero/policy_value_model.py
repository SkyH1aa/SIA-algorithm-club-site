import torch
from torch import nn


class PolicyValueBackend(nn.Module):
    """Shared convolutional backend for policy and value heads."""

    def __init__(self, in_channels: int, channels: int, board_height: int, board_width: int):
        super().__init__()
        self.layers = nn.Sequential(
            self._make_block(in_channels, channels, board_height, board_width),
            self._make_block(channels, channels, board_height, board_width),
            self._make_block(channels, channels, board_height, board_width),
        )

    @staticmethod
    def _make_block(
        in_channels: int,
        out_channels: int,
        board_height: int,
        board_width: int,
    ) -> nn.Sequential:
        return nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1),
            nn.LayerNorm([out_channels, board_height, board_width]),
            nn.SiLU(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.layers(x)


class PolicyHead(nn.Module):
    """Outputs move logits for every board position."""

    def __init__(self, channels: int, board_height: int, board_width: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(channels, 2, kernel_size=1),
            nn.SiLU(),
            nn.Flatten(),
            nn.Linear(2 * board_height * board_width, board_height * board_width),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class ValueHead(nn.Module):
    """Outputs a scalar win-rate estimate in [0, 1]."""

    def __init__(self, channels: int, board_height: int, board_width: int):
        super().__init__()
        value_channels = max(4, channels // 16)
        self.net = nn.Sequential(
            nn.Conv2d(channels, value_channels, kernel_size=1),
            nn.SiLU(),
            nn.Flatten(),
            nn.Linear(value_channels * board_height * board_width, 64),
            nn.SiLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class PolicyValueModel(nn.Module):
    """Two-head network that predicts policy logits and win rate."""

    def __init__(self, in_channels: int, channels: int, board_height: int, board_width: int):
        super().__init__()
        self.backend = PolicyValueBackend(in_channels, channels, board_height, board_width)
        self.policy_head = PolicyHead(channels, board_height, board_width)
        self.value_head = ValueHead(channels, board_height, board_width)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Return [policy_logits, value_estimate]
            policy_logits: (batch_size, board_height * board_width)
            value_estimate: (batch_size, 1)
        """
        features = self.backend(x)
        policy = self.policy_head(features)
        value = self.value_head(features)
        return policy, value


if __name__ == "__main__":
    # Example usage
    model = PolicyValueModel(in_channels=2, channels=128, board_height=15, board_width=15)
    print(f"参数量: {sum(p.numel() for p in model.parameters())}")
    dummy_input = torch.randn(1, 2, 15, 15)  # Batch size of 1
    policy_logits, value_estimate = model(dummy_input)
    print("Policy logits shape:", policy_logits.shape)  # Should be (1, 225)
    print("Value estimate shape:", value_estimate.shape)  # Should be (1, 1)
