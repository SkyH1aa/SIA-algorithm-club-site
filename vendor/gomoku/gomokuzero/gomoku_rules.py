from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


Move = int


@dataclass(frozen=True)
class GomokuRules:
    """Board utilities and game-end rules for freestyle Gomoku."""

    board_height: int = 15
    board_width: int = 15
    player_values: tuple[int, int] = (1, -1)

    def __init__(
        self,
        board_height: int = 15,
        board_width: int = 15,
        player_values: Sequence[int] = (1, -1),
    ) -> None:
        if len(player_values) != 2 or player_values[0] == player_values[1]:
            raise ValueError("player_values must contain two distinct player encodings.")

        object.__setattr__(self, "board_height", board_height)
        object.__setattr__(self, "board_width", board_width)
        object.__setattr__(self, "player_values", (int(player_values[0]), int(player_values[1])))

    @property
    def board_size(self) -> int:
        return self.board_height * self.board_width

    def as_board(self, board: np.ndarray) -> np.ndarray:
        board = np.asarray(board)
        expected_shape = (self.board_height, self.board_width)
        if board.shape != expected_shape:
            raise ValueError(f"Expected board shape {expected_shape}, got {board.shape}.")
        return board

    def legal_moves(self, board: np.ndarray) -> np.ndarray:
        board = self.as_board(board)
        return np.flatnonzero(board.reshape(-1) == 0)

    def candidate_moves(self, board: np.ndarray, distance: int | None) -> np.ndarray:
        """Return legal moves near existing stones, or all legal moves if distance is None."""
        legal_moves = self.legal_moves(board)
        if distance is None:
            return legal_moves
        if distance < 0:
            raise ValueError("distance must be non-negative or None.")
        if len(legal_moves) == 0:
            return legal_moves

        occupied = np.argwhere(self.as_board(board) != 0)
        if len(occupied) == 0:
            center = (self.board_height // 2) * self.board_width + (self.board_width // 2)
            return np.asarray([center], dtype=np.int64)

        candidates = np.zeros(self.board_size, dtype=bool)
        board_array = self.as_board(board)
        for row, col in occupied:
            row_start = max(0, int(row) - distance)
            row_end = min(self.board_height, int(row) + distance + 1)
            col_start = max(0, int(col) - distance)
            col_end = min(self.board_width, int(col) + distance + 1)
            window = board_array[row_start:row_end, col_start:col_end]
            empty_rows, empty_cols = np.where(window == 0)
            if len(empty_rows) == 0:
                continue
            absolute_rows = empty_rows + row_start
            absolute_cols = empty_cols + col_start
            candidates[absolute_rows * self.board_width + absolute_cols] = True

        candidate_moves = np.flatnonzero(candidates)
        return candidate_moves if len(candidate_moves) > 0 else legal_moves

    def next_board(self, board: np.ndarray, move: Move, current_player: int) -> np.ndarray:
        board = self.as_board(board)
        self.validate_player(current_player)

        row, col = divmod(int(move), self.board_width)
        if not (0 <= row < self.board_height and 0 <= col < self.board_width):
            raise ValueError(f"Illegal move {move}: outside the board.")
        if board[row, col] != 0:
            raise ValueError(f"Illegal move {move}: position is already occupied.")

        next_board = board.copy()
        next_board[row, col] = current_player
        return next_board

    def find_winning_move(
        self,
        board: np.ndarray,
        player: int,
        legal_moves: np.ndarray | None = None,
    ) -> Move | None:
        board = self.as_board(board)
        self.validate_player(player)
        moves = self.legal_moves(board) if legal_moves is None else np.asarray(legal_moves)
        for move in moves:
            row, col = divmod(int(move), self.board_width)
            board[row, col] = player
            wins = self.has_five_from(board, int(move), player)
            board[row, col] = 0
            if wins:
                return int(move)
        return None

    def next_player(self, current_player: int) -> int:
        return self.opponent_of(current_player)

    def opponent_of(self, current_player: int) -> int:
        self.validate_player(current_player)
        if current_player == self.player_values[0]:
            return self.player_values[1]
        return self.player_values[0]

    def validate_player(self, current_player: int) -> None:
        if current_player not in self.player_values:
            raise ValueError(f"current_player must be one of {self.player_values}, got {current_player}.")

    def encode_state(self, board: np.ndarray, current_player: int) -> np.ndarray:
        """Return 2 channels: current player's stones, then opponent's stones."""
        board = self.as_board(board)
        opponent = self.opponent_of(current_player)
        return np.stack(
            [
                board == current_player,
                board == opponent,
            ]
        ).astype(np.float32)

    def game_end(self, board: np.ndarray) -> tuple[bool, int]:
        """Return (ended, winner). winner is 0 for draw or unfinished games."""
        board = self.as_board(board)
        for player in self.player_values:
            if self.has_five(board, player):
                return True, int(player)
        if not np.any(board == 0):
            return True, 0
        return False, 0

    def game_end_after_move(self, board: np.ndarray, last_move: Move, player: int) -> tuple[bool, int]:
        """Return game end status by checking only lines through the last move."""
        board = self.as_board(board)
        self.validate_player(player)
        if self.has_five_from(board, last_move, player):
            return True, int(player)
        if not np.any(board == 0):
            return True, 0
        return False, 0

    def has_five(self, board: np.ndarray, player: int) -> bool:
        board = self.as_board(board)
        directions = ((1, 0), (0, 1), (1, 1), (1, -1))
        rows, cols = board.shape

        for row, col in np.argwhere(board == player):
            for dr, dc in directions:
                prev_r, prev_c = row - dr, col - dc
                if 0 <= prev_r < rows and 0 <= prev_c < cols and board[prev_r, prev_c] == player:
                    continue

                count = 0
                r, c = row, col
                while 0 <= r < rows and 0 <= c < cols and board[r, c] == player:
                    count += 1
                    if count >= 5:
                        return True
                    r += dr
                    c += dc
        return False

    def has_five_from(self, board: np.ndarray, move: Move, player: int) -> bool:
        board = self.as_board(board)
        self.validate_player(player)
        row, col = divmod(int(move), self.board_width)
        if not (0 <= row < self.board_height and 0 <= col < self.board_width):
            raise ValueError(f"Illegal move {move}: outside the board.")
        if board[row, col] != player:
            return False

        directions = ((1, 0), (0, 1), (1, 1), (1, -1))
        for dr, dc in directions:
            count = 1
            count += self._count_in_direction(board, row, col, dr, dc, player)
            count += self._count_in_direction(board, row, col, -dr, -dc, player)
            if count >= 5:
                return True
        return False

    def _count_in_direction(
        self,
        board: np.ndarray,
        row: int,
        col: int,
        dr: int,
        dc: int,
        player: int,
    ) -> int:
        count = 0
        r, c = row + dr, col + dc
        while 0 <= r < self.board_height and 0 <= c < self.board_width and board[r, c] == player:
            count += 1
            r += dr
            c += dc
        return count
