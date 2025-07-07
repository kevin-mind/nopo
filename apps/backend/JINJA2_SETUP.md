# Django Jinja2 Template Setup

This document outlines the setup and implementation of Jinja2 templates in the Django backend application.

## What Was Implemented

### 1. Dependencies
- Added `jinja2>=3.1.0` to `pyproject.toml`

### 2. Django Configuration

#### Template Engine Configuration (`settings.py`)
- Updated `TEMPLATES` setting to use both Jinja2 and Django template engines
- Jinja2 is the primary engine for custom templates
- Django template engine remains for admin interface compatibility

#### Jinja2 Environment (`src/mysite/jinja2.py`)
- Created custom Jinja2 environment configuration
- Added Django-specific functions:
  - `static()` for static file URLs
  - `url()` for URL reversing

### 3. Template Structure

```
src/templates/
├── base.html                    # Base template with layout and styling
├── home.html                    # Home page template extending base
└── partials/
    └── user_info.html           # Partial template demonstrating data passing
```

### 4. Features Demonstrated

#### Template Inheritance
- `home.html` extends `base.html`
- Block system for customizing different sections:
  - `title` - Page title
  - `header` - Main header content
  - `subheader` - Subtitle content
  - `content` - Main page content

#### Partial Templates
- `partials/user_info.html` demonstrates:
  - Data passing from views to partials
  - Conditional rendering based on data availability
  - Loop processing for dynamic content
  - Filter usage (title, default, etc.)

#### View Integration (`src/mysite/urls.py`)
- Updated `home()` view to render Jinja2 template
- Passes sample data to demonstrate partial functionality:
  - User information
  - System stats
  - Preferences data

## Key Jinja2 Features Used

### Template Syntax
- `{% extends "base.html" %}` - Template inheritance
- `{% block content %}...{% endblock %}` - Block definitions
- `{% include "partials/user_info.html" %}` - Including partials
- `{{ variable }}` - Variable interpolation
- `{% if condition %}...{% endif %}` - Conditional rendering
- `{% for item in items %}...{% endfor %}` - Loop processing

### Filters
- `{{ value | default('fallback') }}` - Default values
- `{{ text | title }}` - Title case conversion
- `{{ date.strftime('%Y-%m-%d %H:%M:%S UTC') }}` - Date formatting

### Django Integration
- `{{ static('favicon.ico') }}` - Static file URLs
- Compatible with Django's `render()` function
- Supports Django context data

## Testing

The setup has been verified to work correctly:

```bash
# Check Django configuration
uv run python manage.py check

# Test template rendering
uv run python manage.py runserver
```

## Usage Examples

### Creating New Templates
1. Create template files in `src/templates/`
2. Use Jinja2 syntax for inheritance and includes
3. Pass data from Django views using `render()`

### Adding Custom Filters
Add to `src/mysite/jinja2.py`:
```python
def environment(**options):
    env = Environment(**options)
    env.globals.update({
        'static': staticfiles_storage.url,
        'url': reverse,
    })
    # Add custom filters
    env.filters['custom_filter'] = my_custom_filter
    return env
```

## Benefits Over Django Templates

- More familiar syntax for developers coming from other frameworks
- Better performance in many cases
- More powerful and flexible filtering system
- Cleaner template inheritance model
- Better error messages and debugging

## File Changes Made

1. `pyproject.toml` - Added Jinja2 dependency
2. `settings.py` - Updated TEMPLATES configuration
3. `src/mysite/jinja2.py` - Created Jinja2 environment
4. `src/mysite/urls.py` - Updated home view to render template
5. `src/templates/` - Created template directory structure
6. `src/static/` - Created missing static directory

The Django application now successfully uses Jinja2 as the primary template engine while maintaining compatibility with Django's admin interface.