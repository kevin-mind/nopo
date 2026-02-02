"""Utility functions for the backend application."""


def format_greeting(name: str, *, formal: bool = False) -> str:
    """Format a greeting message.

    Args:
        name: The name to greet
        formal: If True, use formal greeting. Default is False.

    Returns:
        A formatted greeting string

    Examples:
        >>> format_greeting("Alice")
        'Hello, Alice!'
        >>> format_greeting("Bob", formal=True)
        'Good day, Bob.'
    """
    if not name or not name.strip():
        raise ValueError("Name cannot be empty")

    name = name.strip()

    if formal:
        return f"Good day, {name}."
    return f"Hello, {name}!"
